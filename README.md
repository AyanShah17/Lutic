# Kojo — Industrial Operations AI Platform

Kojo is a multi-tenant industrial operations platform for role-governed access to plant manuals, machine telemetry, alarms, and work orders. Analysts can build operational dashboards from governed metrics.

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

Deploy with PostgreSQL and `pgvector`, unique deployment secrets, TLS at the web ingress, and a reachable ClamAV daemon (`clamd`) for uploads. Production startup migrates the schema and requires an explicitly bootstrapped tenant. Demo seeding and demo sign-in are disabled in production. See the [production deployment guide](PRODUCTION.md).

---

## Demo Accounts (Dev Only — Password: `kojo-demo-password`)

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
|  Orchestrator (max 8 steps) -> 6-Step Policy Engine                       |
|  Hybrid RAG (pgvector + tsvector + Exact Codes + RRF + Reranker)        |
|  KojoLLMGateway (kojo-gateway | mock | anthropic | openai)               |
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
bun run test        # Vitest unit & security test suite (RBAC, Policy Engine, RAG, RLS, Encryption)
bun run build       # Production build verification across all packages and apps/web
```

Local verification covered the build and PGlite-backed Vitest suites. CI is configured to run a separate PostgreSQL integration suite. Docker deployment, native PostgreSQL, and live LLM calls were outside the local verification run.

---

## Integrations

The built-in Kojo connector protocol (`kojo://` / `mcp://`) executes standard governed tool calls against data in Kojo; supplied-script execution ("Kojo Code Mode", `execute_connector_code`) is disabled (`HTTP 501` / P0-07). Administrators can load manuals and ingest machine snapshots through the telemetry API. Local workflow conditions, notifications, queues, and work-order steps are available. External connector invocation and sync, webhook delivery, and workflow AI steps are unavailable in production.

Chat supports `KojoLLMGateway` (`LLM_PROVIDER=kojo` with `KOJO_AI_GATEWAY_URL` + `KOJO_AI_GATEWAY_KEY`, or Anthropic/OpenAI providers) via `LLM_PROVIDER`. Retrieval uses local deterministic embeddings with any configured chat provider.
