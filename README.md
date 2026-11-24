# Lutic — Industrial Operations Platform (`lutic.app`)

Lutic ([lutic.app](https://lutic.app)) is a multi-tenant industrial operations platform for role-governed access to plant manuals, machine telemetry, alarms, work orders, external SaaS/API connectors (Remote MCP & UTCP), and LiteLLM-routed AI chat. Analysts can build operational dashboards from governed metrics.

See [PRODUCTION.md](PRODUCTION.md) for deployment setup and [SECURITY.md](SECURITY.md) for the security architecture.

---

## Local Demo

1. Install dependencies using [Bun](https://bun.sh) 1.4.2, the version pinned in CI.
   ```bash
   bun install --frozen-lockfile
   ```

2. Use `.env.example` as a starting point for a local `.env` if one is needed. The local defaults use PGlite with `pgvector` at `.data/pglite`, a mock chat model, and deterministic embeddings. The demo runs without API keys.

3. Seed the synthetic plants and start the development server.
   ```bash
   bun run db:seed
   bun run dev
   ```
   Open [localhost:3000](http://localhost:3000) and use a demo account or the demo persona picker. Run `bun run sim` in a second terminal to generate local telemetry and alarms.

## Production

Deploy with PostgreSQL and `pgvector`, unique deployment secrets, TLS at the web ingress, and a reachable ClamAV daemon (`clamd`) for uploads. Production startup migrates the schema and requires an explicitly bootstrapped tenant (`bun run db:bootstrap` or `bash deploy/lutic.sh bootstrap`), which provisions the first tenant, plant, admin, core toolkits, 5 built-in local connectors (`mcp://`), default topic (`plant-alerts`), and queue (`ops-dispatch`) without demo data. Demo seeding and demo sign-in are disabled in production. See the [production deployment guide](PRODUCTION.md).

## Branch Topology

- `base`: Clean core platform (no Playwright, `e2e-paas`, `packages/evals`, `apps/mobile`, `apps/license-server`, or standalone feature integrations).
- `feat/bootstrap`, `feat/litellm-gateway`, `feat/utcp-mcp-connectors`, `feat/code-mode`: Standalone upgradeable feature branches rooted on `base`.
- `prod`: Release branch integrating bootstrap, Remote MCP/UTCP and LiteLLM. Code Mode is disabled in production. (`main` retains the original pre-cleanup workspace snapshot.)

---

## Demo Accounts (Dev Only — Password: `lutic-demo-password`)

| Role | Email | Authorized Plants | Capabilities |
| --- | --- | --- | --- |
| `engineer` | `engineer@acme.demo` | Detroit (`plant-detroit`) | Manuals, alarms, readings, work orders, parts, confirmed work-order/part drafts. **No analytics or dashboard edits.** |
| `engineer` | `austin.engineer@acme.demo` | Austin (`plant-austin`) | Scoped strictly to Austin machines/alarms/parts. |
| `analyst` | `analyst@acme.demo` | Detroit & Austin | Everything engineer reads + semantic metrics (OEE, downtime, scrap, energy, MTBF/MTTR) + visual dashboard builder & sharing. |
| `manager` | `manager@acme.demo` | Detroit & Austin | Read access to chat, metrics, and shared dashboards (read-only). |
| `admin` | `admin@acme.demo` | Detroit & Austin | Full platform + `/admin` console (users, encrypted connectors, live toolkits, knowledge ingestion, audit CSV, usage, assets/QR). |

---

## Architecture

```text
+-------------------------------------------------------------------------+
| Surfaces (apps/web - Next.js 15 App Router)                             |
|  /chat (Streaming, Citations, What I Checked) | /m/[machineId] (QR)     |
|  /dashboards (Visual Builder & Read-Only)     | /admin (Governance)     |
+------------------------------------+------------------------------------+
                                     | authorize(user, perm, resource)
+------------------------------------v------------------------------------+
| Agent Layer (packages/agent)                                            |
|  Orchestrator (max 8 steps) -> 6-Step Policy Engine                      |
|  Hybrid RAG (pgvector + tsvector + Exact Codes + RRF + Reranker)        |
|  LuticLLMGateway (LiteLLM lutic-gateway | mock | anthropic | openai)     |
+------------------------------------+------------------------------------+
                                     | @modelcontextprotocol/sdk (InMemory/Stdio)
+------------------------------------v------------------------------------+
| Connectors Layer (packages/connectors)                                  |
|  Core MCP servers: docs | historian | cmms | parts-erp | mes           |
+------------------------------------+------------------------------------+
                                     | Scoped SQL + Postgres RLS + date_bin
+------------------------------------v------------------------------------+
| Data & Semantic Layer (packages/core)                                   |
|  PostgreSQL 16 + pgvector | Drizzle ORM | 12 Governed Semantic Metrics  |
|  Declarative Dashboard Spec (Zod) | TimeSeriesStore | AES-256-GCM      |
+-------------------------------------------------------------------------+
```

---

## Scripts & Verification

```bash
bun run typecheck   # Strict TypeScript check across all workspace packages
bun run lint        # ESLint + TypeScript lint across packages and Next.js
bun run test        # Vitest unit, security, UTCP/MCP, Code Mode & deployment suite
bun run build       # Production build verification across deployable packages and apps/web
```

Local verification covers typechecks, lint, PGlite-backed security/connector/Code Mode tests, and the Next.js production build. CI runs native PostgreSQL integration tests and Docker container smoke checks.

---

## Integrations

- **LiteLLM Proxy (`LUTIC_AI_GATEWAY_URL`)**: Self-hosted in [docker-compose.yml](docker-compose.yml) using [deploy/litellm_config.yaml](deploy/litellm_config.yaml), routing `lutic-claude`, `lutic-gpt4o`, and `lutic-mini` through `LuticLLMGateway` alongside direct Anthropic/OpenAI keys.
- **UTCP + Remote MCP + 1,000+ Ecosystem Connectors**: Built-in adapters (`lutic://` / `mcp://`), Streamable HTTP Remote MCP (`remote_mcp` for Metorial, OpenConnectors, and UTCP-MCP bridges), UTCP 1.0 / OpenAPI 3.x direct HTTP manuals (`utcp_http`), and authenticated UTCP manual export (`GET /api/connectors/utcp`).
- **Lutic Code Mode** is available only for trusted development and test scripts. Production users can invoke individual connector tools.
