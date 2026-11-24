import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  auditLog,
  buildKojoConnectorManual,
  connectorSyncLogs,
  createDbConnection,
  desc,
  eq,
  seedDatabase,
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
});
