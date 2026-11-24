import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertSafeExternalUrl,
  auditLog,
  buildKojoConnectorManual,
  connectorConnections,
  connectorSyncLogs,
  createDbConnection,
  desc,
  eq,
  isCodeModeEnabled,
  seedDatabase,
  syncConnectorConnection,
  testConnectorConnection,
  withTenantScope,
  type DbConnection,
  type SessionUser
} from "@kojo/core";
import { McpToolRegistry, PAAS_CONNECTORS } from "@kojo/connectors";
import {
  createLLMProvider,
  executeKojoConnectorCode,
  executeToolWithPolicy,
  getAllowedToolsForUser,
  KojoLLMGateway,
  MockLLMProvider,
  resolveKojoGatewayRoute,
  runAgentTurn
} from "@kojo/agent";
import { POST as invokeConnector } from "../apps/web/src/app/api/connectors/[id]/invoke/route";
import { GET as getConnectors } from "../apps/web/src/app/api/connectors/route";
import { GET as getUtcpManual } from "../apps/web/src/app/api/connectors/utcp/route";

const state = vi.hoisted(() => ({ conn: undefined as DbConnection | undefined }));

vi.mock("../apps/web/src/lib/db", () => ({
  requireWebLicense: async () => {},
  withWebTenantDb: async (tenant: string, fn: Parameters<typeof withTenantScope>[2]) =>
    withTenantScope(state.conn!.db, tenant, fn)
}));

vi.mock("../apps/web/src/lib/auth", async (original) => ({
  ...(await original<typeof import("../apps/web/src/lib/auth")>()),
  getSessionUser: async () => ({
    userId: "user-admin",
    tenantId: "tenant-acme",
    role: "admin",
    plantIds: ["plant-detroit", "plant-austin"],
    email: "admin@acme.demo",
    name: "Admin User"
  })
}));

const detroitEngineer: SessionUser = {
  userId: "user-det-eng",
  tenantId: "tenant-acme",
  role: "engineer",
  plantIds: ["plant-detroit"],
  email: "engineer@acme.demo",
  name: "Detroit Engineer"
};

const adminUser: SessionUser = {
  userId: "user-admin",
  tenantId: "tenant-acme",
  role: "admin",
  plantIds: ["plant-detroit", "plant-austin"],
  email: "admin@acme.demo",
  name: "Admin User"
};

let registry: McpToolRegistry;

beforeAll(async () => {
  state.conn = await createDbConnection("memory://");
  await seedDatabase(state.conn);
  registry = new McpToolRegistry(PAAS_CONNECTORS);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await state.conn?.close();
});

describe("Kojo AI Gateway (LiteLLM), UTCP/MCP Bridges & Isolated Code Mode", () => {
  it("enables Code Mode only for explicit trusted development and test runtimes", () => {
    expect(isCodeModeEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isCodeModeEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(isCodeModeEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isCodeModeEnabled({})).toBe(false);
    expect(isCodeModeEnabled({ NODE_ENV: "staging" })).toBe(false);
  });

  it("resolves Kojo-branded routes for LiteLLM / KOJO_AI_GATEWAY_URL, direct providers, and deterministic fallback", () => {
    const gatewayRoute = resolveKojoGatewayRoute({
      model: "kojo-claude",
      gatewayUrl: "http://litellm:4000/v1",
      gatewayKey: "kojo-gw-secret"
    });
    expect(gatewayRoute).toEqual({
      routeType: "kojo-gateway",
      brandedModel: "kojo/kojo-claude",
      upstreamModel: "kojo-claude",
      baseURL: "http://litellm:4000/v1"
    });

    const openaiRoute = resolveKojoGatewayRoute({
      model: "openai/gpt-4o-mini",
      gatewayUrl: "",
      gatewayKey: "",
      anthropicApiKey: "",
      openaiApiKey: "sk-test-openai"
    });
    expect(openaiRoute).toEqual({
      routeType: "openai",
      brandedModel: "kojo/openai/gpt-4o-mini",
      upstreamModel: "gpt-4o-mini"
    });

    const fallbackRoute = resolveKojoGatewayRoute({
      model: "kojo/claude-sonnet-4-6",
      gatewayUrl: "",
      gatewayKey: "",
      anthropicApiKey: "",
      openaiApiKey: ""
    });
    expect(fallbackRoute).toEqual({
      routeType: "kojo-deterministic",
      brandedModel: "kojo-deterministic-v1",
      upstreamModel: "kojo-deterministic-v1"
    });

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LLM_PROVIDER", "kojo");
    vi.stubEnv("LLM_MODEL", "kojo-claude");
    vi.stubEnv("KOJO_AI_GATEWAY_URL", "http://litellm:4000/v1");
    vi.stubEnv("KOJO_AI_GATEWAY_KEY", "kojo-gw-secret");
    const created = createLLMProvider();
    expect(created).toBeInstanceOf(KojoLLMGateway);
    expect(created.id).toBe("kojo-gateway");
    expect(created.modelName).toBe("kojo/kojo-claude");
  });

  it("executes multi-tool isolated Code Mode scripts with RBAC, plant scoping, and write confirmation", async () => {
    const manual = buildKojoConnectorManual({
      slug: "historian",
      transport: "kojo_protocol",
      endpointUrl: "kojo://historian",
      discoveredTools: [{ name: "get_machine_status" }, { name: "get_active_alarms" }]
    });
    expect(manual.protocol).toBe("kojo-connector-v1");
    expect(manual.codeModeGlobal).toBe("kojo");

    const adminTools = await getAllowedToolsForUser(state.conn!.db, adminUser, registry);
    expect(adminTools.some((t) => t.name === "execute_connector_code")).toBe(true);

    const codeRes = await executeKojoConnectorCode({
      code: `
        const status = await kojo.callTool("get_machine_status", { machineId: input.machineId });
        const alarms = await kojo.tools.get_active_alarms({ machineId: input.machineId });
        const wo = await kojo.connectors.cmms.get_work_orders({ machineId: input.machineId, limit: 3 });
        console.log("checked", input.machineId);
        return { status, alarmsCount: alarms.alarms.length, woCount: wo.workOrders.length };
      `,
      input: { machineId: "mach-l3-filler-01" },
      ctx: { db: state.conn!.db, user: detroitEngineer, requestId: "req-cm-multi" },
      options: { registry }
    });
    expect(codeRes.status).toBe("allowed");
    expect(codeRes.logs).toEqual(["checked mach-l3-filler-01"]);
    expect(codeRes.innerCalls.map((c) => c.toolName)).toEqual([
      "get_machine_status",
      "get_active_alarms",
      "get_work_orders"
    ]);

    // RBAC denial enforced on inner calls
    const rbacRes = await executeToolWithPolicy(
      "execute_connector_code",
      { code: 'return await kojo.callTool("query_metric", { metric: "oee", range: "7d" });' },
      { db: state.conn!.db, user: detroitEngineer, requestId: "req-cm-rbac" },
      { registry }
    );
    expect(rbacRes.status).toBe("error");
    expect(rbacRes.denialReason).toMatch(/not enabled/i);

    // Plant scoping enforced on inner calls
    const scopeRes = await executeToolWithPolicy(
      "execute_connector_code",
      { code: 'return await kojo.callTool("get_machine_status", { machineId: "mach-aus-comp-01" });' },
      { db: state.conn!.db, user: detroitEngineer, requestId: "req-cm-scope" },
      { registry }
    );
    expect(scopeRes.status).toBe("error");
    expect(scopeRes.denialReason).toMatch(/outside your plant scope/i);

    // Write tool confirmation propagated out of child process
    const writeRes = await executeToolWithPolicy(
      "execute_connector_code",
      {
        code: `
          await kojo.callTool("get_active_alarms", { machineId: "mach-l3-filler-01" });
          return await kojo.callTool("draft_work_order", {
            machineId: "mach-l3-filler-01",
            priority: "high",
            type: "corrective",
            description: "Isolated Code Mode E42 triage"
          });
        `
      },
      { db: state.conn!.db, user: detroitEngineer, requestId: "req-cm-write" },
      { registry }
    );
    expect(writeRes.status).toBe("requires_confirmation");
    expect(writeRes.pendingAction?.toolName).toBe("draft_work_order");
    expect(writeRes.pendingAction?.id).toMatch(/^act-/);
  });

  it("isolates host secrets (empty child env) and forcefully kills post-await infinite CPU loops via SIGKILL", async () => {
    vi.stubEnv("KOJO_SECRET_CANARY", "host-only-secret-xyz");

    // 1. Even with constructor chain access inside JS, child has empty env and no DB/secrets
    const envProbe = await executeKojoConnectorCode({
      code: `
        const fn = kojo.callTool["con" + "structor"];
        const p = fn("return process")();
        return { envKeys: Object.keys(p.env), canary: p.env.KOJO_SECRET_CANARY ?? null };
      `,
      ctx: { db: state.conn!.db, user: adminUser, requestId: "req-cm-env-iso" },
      options: { registry }
    });
    const probeRes = envProbe.result as { envKeys: string[]; canary: string | null };
    expect(probeRes.canary).toBeNull();
    expect(probeRes.envKeys.filter((k) => k !== "NODE_ENV")).toEqual([]);

    // 2. Post-await infinite CPU loop is terminated by parent SIGKILL deadline
    const started = Date.now();
    await expect(
      executeKojoConnectorCode({
        code: `
          await kojo.callTool("get_machine_status", { machineId: "mach-l3-filler-01" });
          while (true) {}
        `,
        ctx: { db: state.conn!.db, user: adminUser, requestId: "req-cm-loop" },
        options: { registry },
        timeoutMs: 300
      })
    ).rejects.toThrow(/timed out/i);
    expect(Date.now() - started).toBeLessThan(2500);

    // 3. Call budget enforced
    await expect(
      executeKojoConnectorCode({
        code: `
          await kojo.callTool("get_machine_status", { machineId: "mach-l3-filler-01" });
          await kojo.callTool("get_active_alarms", { machineId: "mach-l3-filler-01" });
          return true;
        `,
        ctx: { db: state.conn!.db, user: adminUser, requestId: "req-cm-budget" },
        options: { registry },
        maxCalls: 1
      })
    ).rejects.toThrow(/budget exceeded/i);
  });

  it("plans and executes Code Mode inside runAgentTurn and POST /api/connectors/[id]/invoke", async () => {
    const gatewayProvider = new KojoLLMGateway({ allowMockFallback: true });
    expect(gatewayProvider.modelName).toBe("kojo-deterministic-v1");

    const turn = await runAgentTurn({
      db: state.conn!.db,
      llmProvider: new MockLLMProvider(),
      registry,
      user: detroitEngineer,
      message: "Use Code Mode script to inspect Line 3 filler status and active alarms",
      machineId: "mach-l3-filler-01"
    });
    expect(turn.toolCalls.some((t) => t.toolName === "execute_connector_code" && t.status === "allowed")).toBe(true);
    expect(turn.toolCalls.some((t) => t.toolName === "get_machine_status")).toBe(true);
    expect(turn.answer).toContain("Kojo Code Mode Execution");

    const req = new Request("http://localhost/api/connectors/conn-hub-historian/invoke", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({
        mode: "code",
        code: `
          const st = await kojo.callTool("get_machine_status", { machineId: input.machineId });
          return { machineId: input.machineId, temp: st.status.temperature };
        `,
        args: { machineId: "mach-l3-filler-01" }
      })
    });
    const invokeRes = await invokeConnector(req, {
      params: Promise.resolve({ id: "conn-hub-historian" })
    });
    expect(invokeRes.status).toBe(200);
    const body = (await invokeRes.json()) as {
      ok: boolean;
      protocol: string;
      mode: string;
      result: { machineId: string; temp: number };
      innerCalls: Array<{ toolName: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.protocol).toBe("kojo-connector-v1");
    expect(body.mode).toBe("code");
    expect(body.result.machineId).toBe("mach-l3-filler-01");
    expect(typeof body.result.temp).toBe("number");
    expect(body.innerCalls.map((c) => c.toolName)).toEqual(["get_machine_status"]);

    const [latestLog] = await state.conn!.db
      .select()
      .from(connectorSyncLogs)
      .where(eq(connectorSyncLogs.connectionId, "conn-hub-historian"))
      .orderBy(desc(connectorSyncLogs.createdAt))
      .limit(1);
    expect(latestLog?.direction).toBe("code-mode");

    const [latestAudit] = await state.conn!.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "connector_code_invoke"))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    expect(latestAudit?.toolName).toBe("execute_connector_code");
    expect(latestAudit?.status).toBe("allowed");
  });

  it("fails closed across policy, direct execution, API capability, and invoke route in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const allowed = await getAllowedToolsForUser(state.conn!.db, adminUser, registry);
    expect(allowed.some((tool) => tool.name === "execute_connector_code")).toBe(false);

    const policyResult = await executeToolWithPolicy(
      "execute_connector_code",
      { code: "return true;" },
      { db: state.conn!.db, user: adminUser, requestId: "req-cm-prod" },
      { registry }
    );
    expect(policyResult.status).toBe("denied");
    expect(policyResult.denialReason).toMatch(/not enabled/i);

    await expect(executeKojoConnectorCode({
      code: "return true;",
      ctx: { db: state.conn!.db, user: adminUser, requestId: "req-cm-prod-direct" },
      options: { registry }
    })).rejects.toThrow(/trusted development and test/i);

    const listRes = await getConnectors(new Request("http://localhost/api/connectors"));
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).capabilities).toEqual({ codeMode: false });

    const invokeRes = await invokeConnector(new Request(
      "http://localhost/api/connectors/conn-hub-historian/invoke",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ mode: "code", code: "return true;" })
      }
    ), { params: Promise.resolve({ id: "conn-hub-historian" }) });
    expect(invokeRes.status).toBe(501);
    expect(await invokeRes.json()).toMatchObject({
      title: "Code Mode Unavailable",
      detail: "Kojo Code Mode is available only in trusted development and test runtimes."
    });
  });

  it("discovers and invokes Metorial/OpenConnectors Remote MCP, UTCP 1.0, OpenAPI 3.0, and Kojo UTCP export with SSRF guards", async () => {
    await expect(assertSafeExternalUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(assertSafeExternalUrl("http://127.0.0.1:4000/v1")).rejects.toThrow();
    await expect(assertSafeExternalUrl("https://localhost:3000/api")).rejects.toThrow();
    await expect(assertSafeExternalUrl("https://10.0.0.15/mcp")).rejects.toThrow();

    let baseUrl = "";
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url ?? "/", baseUrl || "http://127.0.0.1");
      const chunks: Buffer[] = [];
      for await (const ch of req) chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
      const bodyStr = Buffer.concat(chunks).toString("utf8");

      if (reqUrl.pathname === "/mcp" && req.method === "POST") {
        if (req.headers.authorization !== "Bearer metorial-test-key") {
          res.writeHead(401).end("Unauthorized");
          return;
        }
        const rpc = JSON.parse(bodyStr) as { id: string; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Mcp-Session-Id", "sess-remote-1");
        if (rpc.method === "initialize") {
          res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2024-11-05" } }));
          return;
        }
        if (rpc.method === "tools/list") {
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpc.id,
              result: {
                tools: [{ name: "slack_post_message", description: "Post Slack alert via Metorial" }]
              }
            })
          );
          return;
        }
        if (rpc.method === "tools/call") {
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpc.id,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({ posted: true, tool: rpc.params?.name, args: rpc.params?.arguments })
                  }
                ]
              }
            })
          );
          return;
        }
      }

      if (reqUrl.pathname === "/utcp.json") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            manual_version: "1.0.0",
            tools: [
              {
                name: "update_ticket",
                description: "Update external ticket status via UTCP",
                tool_call_template: {
                  call_template_type: "http",
                  http_method: "POST",
                  url: `${baseUrl}/api/tickets/{ticketId}`
                }
              }
            ]
          })
        );
        return;
      }

      if (reqUrl.pathname.startsWith("/api/tickets/") && req.method === "POST") {
        const ticketId = reqUrl.pathname.split("/").pop();
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ updated: true, ticketId, payload: JSON.parse(bodyStr || "{}") }));
        return;
      }

      if (reqUrl.pathname === "/openapi.json") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            openapi: "3.0.3",
            servers: [{ url: baseUrl }],
            paths: {
              "/api/orders": {
                get: {
                  operationId: "list_erp_orders",
                  summary: "List ERP maintenance orders",
                  parameters: [{ name: "plant", schema: { type: "string" } }]
                }
              }
            }
          })
        );
        return;
      }

      if (reqUrl.pathname === "/api/orders" && req.method === "GET") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ orders: [{ id: "PO-901", plant: reqUrl.searchParams.get("plant") }] }));
        return;
      }

      res.writeHead(404).end("Not Found");
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("KOJO_DEMO_MODE", "false");
      vi.stubEnv("KOJO_ALLOW_PRIVATE_CONNECTOR_URLS", "true");
      vi.stubEnv(
        "CREDENTIAL_ENCRYPTION_KEY",
        "c1d2e3f4a5b60718293a4b5c6d7e8f90c1d2e3f4a5b60718293a4b5c6d7e8f90"
      );

      const { encryptCredentials } = await import("@kojo/core");
      await state.conn!.db.insert(connectorConnections).values([
        {
          id: "conn-metorial-test",
          tenantId: "tenant-acme",
          slug: "metorial",
          name: "Metorial Test MCP",
          category: "mcp",
          transport: "remote_mcp",
          endpointUrl: `${baseUrl}/mcp`,
          encryptedCredentials: encryptCredentials({ token: "metorial-test-key" }),
          status: "disconnected"
        },
        {
          id: "conn-utcp-test",
          tenantId: "tenant-acme",
          slug: "tickets",
          name: "UTCP Tickets API",
          category: "http",
          transport: "utcp_http",
          endpointUrl: `${baseUrl}/utcp.json`,
          status: "disconnected"
        },
        {
          id: "conn-openapi-test",
          tenantId: "tenant-acme",
          slug: "erp-oa",
          name: "OpenAPI ERP Bridge",
          category: "erp",
          transport: "utcp_http",
          endpointUrl: `${baseUrl}/openapi.json`,
          status: "disconnected"
        }
      ]);

      expect(await testConnectorConnection(state.conn!.db, "tenant-acme", "conn-metorial-test")).toMatchObject({
        ok: true,
        supported: true
      });
      const mcpSync = await syncConnectorConnection(state.conn!.db, "tenant-acme", "conn-metorial-test");
      expect(mcpSync.ok).toBe(true);
      expect(mcpSync.tools.map((t) => t.name)).toContain("slack_post_message");

      expect((await syncConnectorConnection(state.conn!.db, "tenant-acme", "conn-utcp-test")).tools.map((t) => t.name)).toContain("update_ticket");
      expect((await syncConnectorConnection(state.conn!.db, "tenant-acme", "conn-openapi-test")).tools.map((t) => t.name)).toContain("list_erp_orders");

      // Invoke Remote MCP directly & OpenAPI GET with query params
      const mcpInvoke = await invokeConnector(
        new Request("http://localhost/api/connectors/conn-metorial-test/invoke", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost" },
          body: JSON.stringify({ toolName: "slack_post_message", args: { channel: "#line3", text: "E42" } })
        }),
        { params: Promise.resolve({ id: "conn-metorial-test" }) }
      );
      expect(mcpInvoke.status).toBe(200);
      expect(await mcpInvoke.json()).toMatchObject({
        ok: true,
        result: { posted: true, tool: "slack_post_message", args: { channel: "#line3", text: "E42" } }
      });

      const oaInvoke = await invokeConnector(
        new Request("http://localhost/api/connectors/conn-openapi-test/invoke", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost" },
          body: JSON.stringify({ toolName: "list_erp_orders", args: { plant: "detroit" } })
        }),
        { params: Promise.resolve({ id: "conn-openapi-test" }) }
      );
      expect(oaInvoke.status).toBe(200);
      expect(await oaInvoke.json()).toMatchObject({
        ok: true,
        result: { orders: [{ id: "PO-901", plant: "detroit" }] }
      });

      await expect(executeKojoConnectorCode({
        code: "return true;",
        ctx: { db: state.conn!.db, user: adminUser, requestId: "req-cm-hybrid-prod" },
        options: { registry }
      })).rejects.toThrow(/trusted development and test/i);

      // Trusted test runtime can chain local Kojo MCP + Remote MCP + UTCP.
      vi.stubEnv("NODE_ENV", "test");
      const chained = await executeKojoConnectorCode({
        code: `
          const st = await kojo.callTool("get_machine_status", { machineId: input.machineId });
          const slack = await kojo.connectors.metorial.slack_post_message({ channel: "#ops", text: st.status.machineId });
          const ticket = await kojo.connectors.tickets.update_ticket({ ticketId: "INC-42", status: "triaged" });
          return { machine: st.status.machineId, posted: slack.posted, ticketId: ticket.ticketId };
        `,
        input: { machineId: "mach-l3-filler-01" },
        ctx: { db: state.conn!.db, user: adminUser, requestId: "req-cm-hybrid" },
        options: { registry }
      });
      expect(chained.result).toEqual({
        machine: "mach-l3-filler-01",
        posted: true,
        ticketId: "INC-42"
      });

      // Authenticated Kojo UTCP 1.0 manual export combines local & registered remote tools
      const utcpRes = await getUtcpManual(new Request("http://localhost/api/connectors/utcp"));
      expect(utcpRes.status).toBe(200);
      const utcpJson = (await utcpRes.json()) as { utcp_version: string; tools: Array<{ name: string }> };
      expect(utcpJson.utcp_version).toBe("1.0.0");
      expect(utcpJson.tools.some((t) => t.name === "get_machine_status")).toBe(true);
      expect(utcpJson.tools.some((t) => t.name === "metorial.slack_post_message")).toBe(true);
      expect(utcpJson.tools.some((t) => t.name === "tickets.update_ticket")).toBe(true);
      expect(utcpJson.tools.some((t) => t.name === "erp-oa.list_erp_orders")).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
