import { spawnSync } from "node:child_process";
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
  CODE_MODE_CONTAINED_MESSAGE,
  CodeModeContainedError,
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

describe("Kojo AI Gateway, Connector Protocol & Code Mode", () => {
  it("resolves Kojo-branded routes for KOJO_AI_GATEWAY_URL, direct providers, and deterministic fallback", () => {
    const gatewayRoute = resolveKojoGatewayRoute({
      model: "claude-sonnet-4-6",
      gatewayUrl: "https://gateway.kojo.local/v1",
      gatewayKey: "kojo-gw-secret"
    });
    expect(gatewayRoute).toEqual({
      routeType: "kojo-gateway",
      brandedModel: "kojo/claude-sonnet-4-6",
      upstreamModel: "claude-sonnet-4-6",
      baseURL: "https://gateway.kojo.local/v1"
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
    vi.stubEnv("KOJO_AI_GATEWAY_URL", "https://gateway.kojo.local/v1");
    vi.stubEnv("KOJO_AI_GATEWAY_KEY", "kojo-gw-secret");
    const created = createLLMProvider();
    expect(created).toBeInstanceOf(KojoLLMGateway);
    expect(created.id).toBe("kojo-gateway");
    expect(created.modelName).toMatch(/^kojo\//);
  });

  it("blocks supplied Code Mode scripts in disposable child processes for host process access and post-await CPU loops", async () => {
    function runChildCodeModeAttempt(scriptSnippet: string) {
      const child = spawnSync("bun", ["-e", scriptSnippet], {
        cwd: process.cwd(),
        timeout: 5000,
        encoding: "utf8"
      });
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      return JSON.parse(child.stdout.trim()) as {
        escaped: boolean;
        elapsedMs?: number;
        name?: string;
        code?: string;
        statusCode?: number;
        message?: string;
      };
    }

    // Bypass vector 1: constructor chain off wrapper function without calling any tool
    const escapeAttempt = runChildCodeModeAttempt(`
      import { executeKojoConnectorCode } from "./packages/agent/src/code-mode.ts";
      try {
        const res = await executeKojoConnectorCode({
          code: 'const fn = kojo.callTool["con" + "structor"]; const p = fn("return process")(); return { pid: p.pid, envKeys: Object.keys(p.env).length };',
          ctx: { db: {}, user: { userId: "u", tenantId: "t", role: "admin", plantIds: [], email: "a@b.c", name: "A" }, requestId: "child-esc" }
        });
        console.log(JSON.stringify({ escaped: true, res }));
      } catch (err) {
        console.log(JSON.stringify({
          escaped: false,
          name: err?.name,
          code: err?.code,
          statusCode: err?.statusCode,
          message: err?.message
        }));
      }
    `);
    expect(escapeAttempt).toEqual({
      escaped: false,
      name: "CodeModeContainedError",
      code: "CODE_MODE_DISABLED",
      statusCode: 501,
      message: CODE_MODE_CONTAINED_MESSAGE
    });

    // Bypass vector 2: post-await CPU loop exceeding timeoutMs must never run or exceed budget
    const loopAttempt = runChildCodeModeAttempt(`
      import { executeKojoConnectorCode } from "./packages/agent/src/code-mode.ts";
      const started = Date.now();
      try {
        const res = await executeKojoConnectorCode({
          code: 'await kojo.callTool("get_machine_status", { machineId: "mach-l3-filler-01" }); const end = Date.now() + 150; while (Date.now() < end) {} return "completed";',
          timeoutMs: 20,
          ctx: { db: {}, user: { userId: "u", tenantId: "t", role: "admin", plantIds: [], email: "a@b.c", name: "A" }, requestId: "child-loop" }
        });
        console.log(JSON.stringify({ escaped: true, elapsedMs: Date.now() - started, res }));
      } catch (err) {
        console.log(JSON.stringify({
          escaped: false,
          elapsedMs: Date.now() - started,
          name: err?.name,
          code: err?.code,
          statusCode: err?.statusCode,
          message: err?.message
        }));
      }
    `);
    expect(loopAttempt.escaped).toBe(false);
    expect(loopAttempt.name).toBe("CodeModeContainedError");
    expect(loopAttempt.code).toBe("CODE_MODE_DISABLED");
    expect(loopAttempt.statusCode).toBe(501);
    expect(loopAttempt.elapsedMs).toBeLessThan(100);

    await expect(
      executeKojoConnectorCode({
        code: "return 1;",
        ctx: { db: state.conn!.db, user: adminUser, requestId: "req-cm-direct" },
        options: { registry }
      })
    ).rejects.toThrow(CodeModeContainedError);
  });

  it("excludes execute_connector_code from policy/catalog/agent turns while preserving governed tools, RBAC, and write confirmation", async () => {
    const manual = buildKojoConnectorManual({
      slug: "historian",
      transport: "kojo_protocol",
      endpointUrl: "kojo://historian",
      discoveredTools: [{ name: "get_machine_status" }, { name: "get_active_alarms" }]
    });
    expect(manual.protocol).toBe("kojo-connector-v1");

    const adminTools = await getAllowedToolsForUser(state.conn!.db, adminUser, registry);
    const engTools = await getAllowedToolsForUser(state.conn!.db, detroitEngineer, registry);
    expect(adminTools.some((t) => t.name === "execute_connector_code")).toBe(false);
    expect(engTools.some((t) => t.name === "execute_connector_code")).toBe(false);

    const policyDenied = await executeToolWithPolicy(
      "execute_connector_code",
      { code: "return 1;" },
      { db: state.conn!.db, user: adminUser, requestId: "req-cm-policy-deny" },
      { registry }
    );
    expect(policyDenied).toMatchObject({
      status: "denied",
      toolName: "execute_connector_code",
      denialReason: CODE_MODE_CONTAINED_MESSAGE
    });

    // Ordinary RBAC, plant-scope, and write confirmation flows remain intact
    const rbacRes = await executeToolWithPolicy(
      "query_metric",
      { metric: "oee", range: "7d" },
      { db: state.conn!.db, user: detroitEngineer, requestId: "req-gov-rbac" },
      { registry }
    );
    expect(rbacRes.status).toBe("denied");
    expect(rbacRes.denialReason).toMatch(/not enabled/i);

    const scopeRes = await executeToolWithPolicy(
      "get_machine_status",
      { machineId: "mach-aus-comp-01" },
      { db: state.conn!.db, user: detroitEngineer, requestId: "req-gov-scope" },
      { registry }
    );
    expect(scopeRes.status).toBe("denied");
    expect(scopeRes.denialReason).toMatch(/outside your plant scope/i);

    const writeRes = await executeToolWithPolicy(
      "draft_work_order",
      {
        machineId: "mach-l3-filler-01",
        priority: "high",
        type: "corrective",
        description: "Governed E42 triage"
      },
      { db: state.conn!.db, user: detroitEngineer, requestId: "req-gov-write" },
      { registry }
    );
    expect(writeRes.status).toBe("requires_confirmation");
    expect(writeRes.pendingAction?.toolName).toBe("draft_work_order");
    expect(writeRes.pendingAction?.id).toMatch(/^act-/);

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
    expect(turn.usage.model).toBe("kojo-deterministic-v1");
    expect(turn.toolCalls.some((t) => t.toolName === "execute_connector_code")).toBe(false);
    expect(turn.toolCalls.some((t) => t.toolName === "get_machine_status" && t.status === "allowed")).toBe(true);
    expect(turn.toolCalls.some((t) => t.toolName === "get_active_alarms" && t.status === "allowed")).toBe(true);
    expect(turn.answer).not.toContain("Kojo Code Mode Execution");
  });

  it("denies Code Mode on POST /api/connectors/[id]/invoke with 501 and audit entry while keeping standard tool calls active", async () => {
    const deniedReq = new Request("http://localhost/api/connectors/conn-hub-historian/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost"
      },
      body: JSON.stringify({
        mode: "code",
        code: "return await kojo.callTool('get_machine_status', { machineId: input.machineId });",
        args: { machineId: "mach-l3-filler-01" }
      })
    });
    const deniedRes = await invokeConnector(deniedReq, {
      params: Promise.resolve({ id: "conn-hub-historian" })
    });
    expect(deniedRes.status).toBe(501);
    const deniedBody = (await deniedRes.json()) as { title: string; status: number; detail: string };
    expect(deniedBody).toMatchObject({
      title: "Code Mode Unavailable",
      status: 501,
      detail: CODE_MODE_CONTAINED_MESSAGE
    });

    const [latestAudit] = await state.conn!.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "connector_code_invoke"))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    expect(latestAudit).toMatchObject({
      action: "connector_code_invoke",
      toolName: "execute_connector_code",
      status: "denied",
      reason: CODE_MODE_CONTAINED_MESSAGE
    });

    const codeModeSyncLogs = await state.conn!.db
      .select()
      .from(connectorSyncLogs)
      .where(eq(connectorSyncLogs.connectionId, "conn-hub-historian"));
    expect(codeModeSyncLogs.some((l) => l.direction === "code-mode")).toBe(false);

    // Standard governed tool invocation on the same endpoint continues to work
    const toolReq = new Request("http://localhost/api/connectors/conn-hub-historian/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost"
      },
      body: JSON.stringify({
        toolName: "get_machine_status",
        args: { machineId: "mach-l3-filler-01" }
      })
    });
    const toolRes = await invokeConnector(toolReq, {
      params: Promise.resolve({ id: "conn-hub-historian" })
    });
    expect(toolRes.status).toBe(200);
    const toolBody = (await toolRes.json()) as {
      ok: boolean;
      toolName: string;
      result: Record<string, unknown>;
    };
    expect(toolBody.ok).toBe(true);
    expect(toolBody.toolName).toBe("get_machine_status");
    expect(toolBody.result).toBeDefined();
  });
});
