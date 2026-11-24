# Kojo Security and Threat Model

## 1. Security Architecture Overview

Kojo enforces authorization, tenant isolation, and tool access in server-side code. Production deployment calls for PostgreSQL with `pgvector`, TLS at the web ingress, unique secrets, and ClamAV for uploads. See the [production deployment guide](PRODUCTION.md).

```
[Browser UI] ──(HTTPS + CSRF/Origin check + Signed JWT Cookie)──▶ [Next.js API Route]
                                                                        │
                                                                 authorize(user, perm, resource)
                                                                        │
                                                                 [Agent Orchestrator]
                                                                        │
                                                            6-Step Policy Engine Gate
                                                                        │
                                                            [MCP Client ──▶ MCP Server]
                                                                        │
                                                      Scoped SQL + Postgres RLS (tenant_id)
```

## 2. Threat Model & Mitigations

### A. Prompt Injection and Model Context

Retrieved documents and tool results are delimited as untrusted data in the prompt. The policy engine separately enforces toolkit membership, permissions, plant scope, argument validation, and tool-specific result bounds. Connector credential handling stays server-side.

When chat uses an external LLM, it sends prompts and selected retrieval or tool context to the configured provider. Retrieval embeddings are computed locally using a deterministic algorithm.

### B. Role and Plant Scope

Session lookups verify the signed token and reload the active user, role, and plant assignments from the database. API and tool permission checks use that scope. Dashboard queries enforce metric and plant permissions per widget, and denied tool calls are audited.

### C. Cross-Tenant Access

Tenant routes and server pages use a transaction under the restricted application role. `withTenantScope` sets the tenant ID for that transaction. PostgreSQL row-level security hides rows from other tenants and rejects writes outside the scope. An empty tenant context gives the application role access to zero tenant rows. Bootstrap, initial identity lookup, and cross-tenant background jobs use explicit administrative access.

### D. Writes, External Connectors & Code Mode

Agent work-order and part-reservation tools first create a pending action. Confirmation verifies the user and uses an idempotency key. Authorized workflow steps can create local work orders, in-app notifications, and queue messages. Remote MCP (`remote_mcp`) and UTCP/OpenAPI (`utcp_http`) bridges enforce HTTPS-only endpoints (unless `KOJO_ALLOW_PRIVATE_CONNECTOR_URLS=true`), private/loopback/metadata IP blocking (including post-DNS lookup checks), disabled redirects, timeouts, and 1 MiB response limits. Raw HTTP/webhook/AI workflow stubs remain unavailable in production (`HTTP 501`).

Production disables Code Mode at the shared executor. The development/test subprocess shares the app's filesystem and network permissions, so only run trusted scripts there. UTCP/OpenAPI attaches stored connector credentials only to requests on the configured origin, including calls made from previously discovered tool definitions.

### E. Credential Protection, Rate Limiting & Uploads

- Connector credentials use AES-256-GCM at rest with `CREDENTIAL_ENCRYPTION_KEY`. Production session cookies are Secure, HttpOnly, and SameSite=Lax. Sign-out revokes the session token server-side.
- Database-backed fixed-window limits apply to login, chat, tool execution, and telemetry ingestion.
- Uploads check file type, enforce `MAX_UPLOAD_BYTES` with a 10 MiB default, and scan content with `clamd`. Production rejects uploads when the scanner is unavailable or returns an invalid response.
- State-changing cookie-authenticated requests check the supplied Origin against the host and allowed origins. HTTP responses include frame, content-sniffing, and referrer protections.

## Verification and Dependency Status

Local tests exercise tenant isolation, request authorization, session invalidation, ClamAV protocol handling, SSRF/UTCP/Remote MCP bridge behavior, and the production Code Mode guard and development/test worker timeout. Native PostgreSQL integration tests (`tests/postgres-integration.test.ts`), Docker `container-smoke`, live `clamd`, and live LiteLLM/upstream LLM calls run in CI or target staging environments.
