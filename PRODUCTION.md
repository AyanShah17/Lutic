# Running Kojo

Kojo supports local development and a portable container deployment. The container can run on a Linux server or a cloud container host with PostgreSQL, ClamAV, and HTTPS. No cloud provider has been provisioned by this change.

## 1. Local development

Use Bun 1.4.2. From the repository root:

```sh
bun install --frozen-lockfile
cp -n .env.example .env
bun run dev
```

Open http://localhost:3000. Development uses an embedded PGlite database, seeded demo accounts, mock chat, and simulated telemetry. Keep this database separate from production. `.env.example` is a development configuration; do not copy its credentials into a deployment. To exercise live chat locally, configure `LLM_PROVIDER=kojo` with the LiteLLM gateway (or direct `anthropic`/`openai`), API key, and model.

## 2. Linux server with Docker Compose

Install Docker Engine with the Compose plugin, OpenSSL, and curl. Allow several GiB of memory for ClamAV in addition to PostgreSQL and the app; size the server using a measured workload. The initial antivirus signature download needs outbound access and can take several minutes.

Generate private configuration:

```sh
bash deploy/kojo.sh prepare
```

This creates `.env.production` with mode 0600 and unique database, authentication, and encryption secrets. Existing configuration is preserved. Edit that file before starting:

- Configure `LLM_PROVIDER=kojo` (`KOJO_AI_GATEWAY_URL=http://litellm:4000/v1`, `KOJO_AI_GATEWAY_KEY` matching `LITELLM_MASTER_KEY`, and `LLM_MODEL=kojo-claude` / `kojo-gpt4o` / `kojo-mini` from `deploy/litellm_config.yaml`), or configure direct `openai`/`anthropic` credentials. Production chat fails if a real provider is not configured; `mock` is for development.
- Set `EMBEDDING_PROVIDER=local`. Retrieval uses deterministic 64-dimensional local vectors plus full-text search. External embedding providers are not implemented.
- If license enforcement is required, supply `LICENSE_SERVER_URL` (HTTPS), `KOJO_LICENSE_KEY`, and the issuer's `LICENSE_SIGNING_SECRET`. Alternatively set `LICENSE_ENFORCE=false` for an installation that does not enforce licenses.
- Leave `COOKIE_SECURE=true`. Configure exact HTTPS origins in `CORS_ORIGINS` only for separately hosted browser clients. Same-origin web use needs no CORS entry.
- Compose supplies `CLAMAV_HOST=clamd` and port 3310. Keep this scanner on a private network.

Create a fresh database and initial administrator (using `bash deploy/kojo.sh bootstrap`, or `bun run db:bootstrap` inside the app container):

```sh
docker compose --env-file .env.production build kojo-paas
docker compose --env-file .env.production up -d --wait postgres
export KOJO_TENANT_NAME='Your company'
export KOJO_PLANT_NAME='Your first plant'
export KOJO_ADMIN_EMAIL='admin@your-company.example'
read -r -s -p 'Initial admin password (16+ characters): ' KOJO_ADMIN_PASSWORD
export KOJO_ADMIN_PASSWORD
bash deploy/kojo.sh bootstrap
unset KOJO_ADMIN_PASSWORD
bash deploy/kojo.sh up
```

The password must be unique and contain varied characters. `bootstrap` installs one tenant, one plant, an administrator, core tool permissions, the 5 built-in local `mcp://` connector connections (without demo secrets), the `plant-alerts` topic, and the `ops-dispatch` queue. It creates no machines, telemetry, manuals, or example customers. It is idempotent and leaves an existing installation untouched. Never run `db:seed` on production; production mode explicitly rejects it.

Schema updates are tracked in `schema_migrations` and serialized under a PostgreSQL transaction advisory lock (`pg_advisory_xact_lock`). The schema initializer needs a database owner capable of creating the `vector` extension, roles, and RLS policies. On a managed database, confirm those privileges before adopting the provider. Tenant requests switch to the restricted `kojo_app` role inside a transaction (`schema_migrations` and `license_state` are revoked from `kojo_app`); administrative authentication, migrations, and runtime tasks use the owner connection. Preserve that separation when adding routes.

### HTTPS and network access

Compose binds the app and database ports to loopback. Put a TLS reverse proxy on the same host and expose only HTTPS to users. For example, a Caddy host configuration is:

```caddyfile
kojo.your-company.example {
    request_body {
        max_size 11MB
    }
    reverse_proxy 127.0.0.1:3000
}
```

Replace the hostname and point DNS at the server. Follow Caddy's [reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) and [request body limits](https://caddyserver.com/docs/caddyfile/directives/request_body) documentation when adapting this configuration. Allow certificate issuance through your proxy's documented setup. Sign in through the HTTPS hostname: production secure cookies will not work over plain remote HTTP. Keep ports 5432 and 3310 private. For another proxy, preserve streaming responses, allow the chat request deadline, forward the original host, and apply an upload body limit.

Check startup with `bash deploy/kojo.sh status` and inspect logs with `bash deploy/kojo.sh logs`. Probe endpoints are separated:

- `GET /api/health/live` reports process liveness without external dependency checks.
- `GET /api/health` verifies database reachability and reports license state (without making paid LLM calls).
- `GET /api/admin/diagnostics` (admin role required) reports DB latency/pool stats, runtime heartbeat, ClamAV `zVERSION` readiness, applied `schema_migrations`, machine telemetry freshness, queue backlog, and configured `DATA_RETENTION_DAYS` (default `90`).

## 3. Portable cloud deployment

Build the same image with `docker build --target runtime -t kojo:YOUR_RELEASE .`. Push it to your chosen private registry and run it on a persistent container host with port 3000 behind HTTPS. Supply the environment variables from `deploy/kojo.env.example` through that host's secret manager. Do not bake secrets into the image.

Use PostgreSQL 16 with pgvector and the bootstrap privileges described above, persistent storage/backups, and TLS appropriate to the provider. Run ClamAV as a private service with `deploy/clamd.conf`, persistent signature updates, and sufficient memory; set `CLAMAV_HOST` to its private address. The ClamAV TCP protocol is not authenticated, so never expose it publicly. Run bootstrap once as a release job using the same image and database URL, then launch the app's default command. Keep the app on an always-running container service, not a short-lived function host.

Before increasing replicas, run the native PostgreSQL integration tests against a dedicated disposable database with the same engine and privileges:

```sh
POSTGRES_TEST_URL='postgresql://TEST_USER:TEST_PASSWORD@TEST_HOST/kojo_test' \
  bunx vitest run tests/postgres-integration.test.ts
```

This suite initializes schema and creates/deletes test records. Never point it at production. The repository CI supplies an isolated pgvector service for these checks.

## First real data

Sign in as the bootstrap administrator. In **Admin → Assets & QR**, create a line and then machines in that line. Add users with their own passwords and plant assignments. Upload trusted machine manuals; production uploads require a healthy scanner. Scanned/image-only PDFs need text extraction outside Kojo before upload; OCR is not implemented.

Send machine snapshots to `POST /api/telemetry` using a dedicated plant-scoped gateway ingestion token (`kjt_...`) issued in **Admin → Assets & QR** (or via `POST /api/admin/ingestion-tokens`). Interactive administrator bearer tokens remain supported for manual testing, but unattended gateways should use scoped ingestion tokens that cannot log into UI endpoints or write to other plants. Rotate or revoke tokens immediately if a gateway is compromised.

```sh
curl --fail-with-body 'https://kojo.your-company.example/api/telemetry' \
  -H "Authorization: Bearer $KOJO_INGESTION_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"samples":[{"sampleId":"press-001-1001","machineId":"YOUR_MACHINE_ID","recordedAt":"2026-11-20T10:00:00Z","status":"running","temperature":43.2,"vibration":1.7,"pressure":6.2,"currentSpeed":91}]}'
```

Replace the timestamp with the actual measurement time (not a future time). Units are Celsius, mm/s, bar, and percent nominal speed. Status is `running`, `idle`, `fault`, or `offline`. Each batch accepts 1–100 complete snapshots, up to 64 KiB, at 60 requests per key per minute. Keep `sampleId` stable on retry: replayed samples are counted as duplicates. Older measurements are stored as history without replacing newer machine status. Plant permissions apply to every machine in a batch.

Users can change their own password from the sidebar security control (`POST /api/auth/change-password`), and admins can reset passwords, revoke active sessions (`token_version` bump), or deactivate accounts in **Admin → Users & Roles** (`PATCH /api/admin/users`).

Local MCP adapters cover stored documents, historian, CMMS, MES, and parts ERP data. Live external integrations run via Streamable HTTP Remote MCP (`remote_mcp` for Metorial, OpenConnectors, UTCP-MCP) and UTCP 1.0 / OpenAPI 3.x direct HTTP bridges (`utcp_http`) over HTTPS. UTCP/OpenAPI calls receive stored connector credentials only on the configured origin (scheme, hostname and port). A tool on another origin must accept calls without those credentials. Production disables Code Mode script execution. Unimplemented raw HTTP/webhook/AI workflow stubs still report unavailable (`HTTP 501` / disabled controls). This release assists operators; validate advice against approved procedures before using it on machinery.

## Backups, key rotation, upgrades, and recovery

Back up the database and encryption key together. Losing `CREDENTIAL_ENCRYPTION_KEY` makes stored connector secrets unreadable. Protect the authentication and license signing secrets separately, restrict backup access, encrypt backups, and retain copies off-host. Use `deploy/backup-restore.sh` to create encrypted backups and run isolated restore verification drills:

```sh
umask 077
export BACKUP_PASSPHRASE='strong-offhost-backup-passphrase'
bash deploy/backup-restore.sh backup --output ./backups/kojo-backup.dump --encrypt
bash deploy/backup-restore.sh restore-verify \
  --input ./backups/kojo-backup.dump.enc \
  --target-db-url 'postgres://user:pass@127.0.0.1:5432/kojo_restore_verify'
```

Never point `restore-verify` at the live production `DATABASE_URL`; test restoration into a separate disposable database first (`restore-verify` checks `to_regclass('public.tenants')` and then `SELECT count(*)::int FROM public.tenants` in two steps so fresh empty targets succeed without `--allow-overwrite`, and also accepts isolated `pglite://` paths for local drills). For Compose containers, you can still stream `pg_dump -Fc` directly from the postgres service. For managed PostgreSQL, also enable provider backups and point-in-time recovery.

### Rotating authentication and encryption keys

To rotate `AUTH_SECRET` without breaking verification cleanly or to rotate `CREDENTIAL_ENCRYPTION_KEY` without losing stored connector credentials:

1. Generate new secret(s) and set `AUTH_SECRET=<new>` with `AUTH_SECRET_PREVIOUS=<old1>,<old2>`, and/or `CREDENTIAL_ENCRYPTION_KEY=<new_64_hex>` with `CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS=<old_64_hex>`.
2. Re-encrypt stored connector credentials under the new key before removing the old key:
   ```sh
   # Docker Compose deployment:
   docker compose --env-file .env.production run --rm --no-deps kojo-paas bun packages/core/src/db/rotate-keys.ts

   # Direct host / local runtime:
   bun packages/core/src/db/rotate-keys.ts
   ```
3. After rolling instances cleanly and letting old sessions expire (or bumping `tokenVersion` via admin reset), remove `*_PREVIOUS` from environment secrets.

Before upgrading, take a backup, retain the previous image, and test the new image against a restored database. Startup applies versioned additive migrations recorded in `schema_migrations` under `pg_advisory_xact_lock`; this is not an automatic schema rollback system. Reverting only the application image may be insufficient after a schema upgrade. Run tenant data retention cleanup periodically from **Admin → Diagnostics & Retention** or `POST /api/admin/retention`. `bash deploy/kojo.sh down` preserves volumes; `docker compose down -v` deletes database volumes and must not be used for an ordinary restart.

Monitor HTTPS availability, error logs, license state, scanner readiness/signature freshness, database capacity, backup age, and telemetry freshness via `GET /api/admin/diagnostics`. Logs should go to your host's log collector with restricted access and retention appropriate to the data.

## Verification boundary

Local verification covers workspace type checks, lint, Vitest regression tests (PGlite unit/integration, lifecycle security, SSRF/UTCP/MCP bridges, and isolated Code Mode subprocess checks), and a production Next.js build. Native PostgreSQL multi-connection tests (`tests/postgres-integration.test.ts`) and the Docker container smoke job (`container-smoke`) are wired into `.github/workflows/ci.yml` and require Docker and PostgreSQL. Live LLM calls, TLS termination, and real third-party SaaS endpoints remain outside local workstation verification and must be validated in target staging.

Verify the CI run and dependency audit (`bun audit --audit-level=high`) for the exact release commit before deploying.
