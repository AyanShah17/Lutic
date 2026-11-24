# Lutic Security and Threat Model

## 1. Security Architecture Overview

Lutic enforces authorization, tenant isolation, and tool access in server-side code. Production deployment calls for PostgreSQL with `pgvector`, TLS at the web ingress, unique secrets, and ClamAV for uploads. See the [production deployment guide](PRODUCTION.md).

```mermaid
flowchart TD
  Browser["Browser UI (apps/web)"] -->|"HTTPS + Origin/CSRF + lutic_session or Clerk Session"| API["Next.js API Route Handler"]
  API -->|"Bearer / Cookie -> Clerk fallback (verified email only)"| Auth["Session & Tenant Identity Bridge"]
  Auth -->|"authorize(user, perm, resource)"| Orch["Agent Orchestrator (max 8 steps default)"]
  Orch -->|"Tool Call Request"| Policy["6-Step Policy Engine (Toolkit, RBAC, Plant Scope, Zod, Rate Limit, Confirm)"]
  Policy -->|"Native Protocol"| LocalMCP["5 Core Built-in Hubs (docs, historian, cmms, parts-erp, mes)"]
  Policy -->|"HTTPS + SSRF IP Check + No Redirects + Same-Origin Creds"| Ext["Lutic Cloud & Direct API Bridges"]
  LocalMCP -->|"withTenantScope (lutic_app)"| DB["PostgreSQL 16 + pgvector RLS (50 Tables)"]
  API -->|"withTenantScope (lutic_app)"| DB
```

## 2. Threat Model & Mitigations

### A. Prompt Injection and Model Context

Retrieved documents and tool results are delimited as untrusted data in the prompt. The policy engine separately enforces toolkit membership, permissions, plant scope, argument validation, and tool-specific result bounds. Connector credential handling stays server-side.

When chat uses an external LLM, it sends prompts and selected retrieval or tool context to the configured provider. Retrieval embeddings are computed locally using a deterministic algorithm.

### B. Identity, Role & Plant Scope

Session lookups check explicit `Authorization: Bearer ...` headers first (never falling back to browser cookies or Clerk on Bearer requests), then signed `lutic_session` cookies, and finally Clerk server sessions (`getClerkServerSessionUser()` in `apps/web/src/lib/clerk.ts`) when configured. Clerk identity bridging enforces `emailVerified === true` before linking `users.external_auth_id` to any existing active account, preventing unverified-email account takeover. Under `LUTIC_DEPLOYMENT_PLAN=enterprise` or an active Enterprise license, unknown external logins are denied (`null`); under `free` / `individual`, a fresh isolated workspace (`tenants.plan = 'free'`), starter plant, and `admin` role are provisioned in one transaction. API, `/board` (`board_issues`), and tool permission checks reload the active DB user, role, and `user_plants` scope on every request and audit denied calls.

### C. Cross-Tenant Access

All `50` tenant-owned tables (including `board_issues` in migration `v3`) run inside a transaction under the restricted `lutic_app` role where `withTenantScope` sets `app.current_tenant_id`. PostgreSQL row-level security hides rows from other tenants and rejects writes outside the scope. An empty tenant context gives the application role zero tenant rows. Bootstrap, initial identity lookup, and cross-tenant background jobs use explicit administrative access.

### D. Writes, External Connectors & Code Mode

Agent work-order and part-reservation tools first create a pending action. Confirmation verifies the user and uses an idempotency key. Authorized workflow steps can create local work orders, in-app notifications, and queue messages. Remote MCP (`remote_mcp`) and UTCP/OpenAPI (`utcp_http`) bridges enforce HTTPS-only endpoints (unless `LUTIC_ALLOW_PRIVATE_CONNECTOR_URLS=true`), private/loopback/metadata IP blocking (including post-DNS lookup checks), disabled redirects, timeouts, and 1 MiB response limits. Raw HTTP/webhook/AI workflow stubs remain unavailable in production (`HTTP 501`).

Production disables Code Mode (`isCodeModeEnabled()` in `packages/core/src/runtime.ts`) fail-closed across the shared executor (`packages/agent/src/code-mode.ts`), policy engine tool list (`packages/agent/src/policy.ts`), capability API (`/api/connectors`), and `POST /api/connectors/[id]/invoke` (`HTTP 501`). The development/test subprocess shares the app's filesystem and network permissions, so only run trusted scripts there. UTCP/OpenAPI (`packages/core/src/external-connectors.ts`) attaches stored connector credentials only when the resolved post-substitution target matches the configured connector origin (`targetUrl.origin === connectorUrl.origin`).

### E. Credential Protection, Rate Limiting & Uploads

- Connector credentials use AES-256-GCM at rest with `CREDENTIAL_ENCRYPTION_KEY`. Production session cookies are Secure, HttpOnly, and SameSite=Lax. Sign-out revokes the session token server-side.
- Database-backed fixed-window limits apply to login, chat, tool execution, and telemetry ingestion.
- Uploads check file type, enforce `MAX_UPLOAD_BYTES` with a 10 MiB default, and scan content with the background antivirus engine (**Lutic Security Scanner**, returning sanitized diagnostics without exposing internal host environment details). Production rejects uploads when the scanner is unavailable or returns an invalid response.
- State-changing cookie-authenticated requests check the supplied Origin against the host and allowed origins. HTTP responses enforce strict CSP (`apps/web/next.config.mjs` allows Clerk/Turnstile origins only when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is configured), frame, content-sniffing, and referrer protections.

## Verification and Dependency Status

Across `20` Vitest suites (`132` total tests), `125` tests run locally (`19` files covering tenant isolation, request authorization, session invalidation, Clerk provisioning & Enterprise invite guards, `/board` RBAC/RLS, white-labeled connector catalog & scanner protocol handling, SSRF/same-origin external bridges, and fail-closed production Code Mode guards + dev/test `SIGKILL` timeout), and `7` native PostgreSQL multi-connection RLS tests (`tests/postgres-integration.test.ts`, skipped locally without `POSTGRES_TEST_URL`) plus Docker `container-smoke` (`"currentVersion":3`) run in GitHub CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)). `bun audit --audit-level=high` passes with `0` vulnerabilities across `768` packages. Live HTTPS TLS termination, live Clerk OAuth on `lutic.app`, live scanner uploads, live AI Gateway upstream calls, and encrypted backup restores remain to be verified on target staging before client rollout.
