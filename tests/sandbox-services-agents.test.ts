import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  computeAgentCapabilities,
  createDbConnection,
  DEMO_PASSWORD,
  resetGlobalDbForTests,
  seedDatabase,
  type DbConnection
} from "@lutic/core";
import { executeToolWithPolicy, runAgentTurn } from "@lutic/agent";
import { POST as signupPost } from "../apps/web/src/app/api/auth/signup/route";
import { POST as loginPost } from "../apps/web/src/app/api/auth/login/route";
import { POST as logoutPost } from "../apps/web/src/app/api/auth/logout/route";
import {
  DELETE as sandboxDelete,
  GET as sandboxGet,
  POST as sandboxPost
} from "../apps/web/src/app/api/sandbox/services/route";
import { POST as chatPost } from "../apps/web/src/app/api/chat/route";
import { POST as aiChangesPost } from "../apps/web/src/app/api/ai/changes/route";

describe("Tenant Sandbox Services, Custom Dashboard, Service Skills & Agent Isolation", () => {
  let conn: DbConnection;

  beforeAll(async () => {
    resetGlobalDbForTests();
    vi.stubEnv("LICENSE_ENFORCE", "false");
    vi.stubEnv("LUTIC_DEMO_MODE", "true");
    conn = await createDbConnection("memory://");
    await seedDatabase(conn);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("LICENSE_ENFORCE", "false");
    vi.stubEnv("LUTIC_DEMO_MODE", "true");
  });

  afterAll(async () => {
    await conn?.close();
    resetGlobalDbForTests();
  });

  it("provisions starter sandbox services per tenant, persists added/removed services and skills across sessions, and rejects cross-service skill injection", async () => {
    const email = "sandbox.owner@lutic.test";
    const password = "SandboxOwnerPassword#2026";

    const signupRes = await signupPost(
      new Request("http://localhost:3000/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          name: "Sandbox Owner",
          workspaceName: "Sandbox Lab",
          email,
          password
        })
      })
    );
    expect(signupRes.status).toBe(201);
    const { token: tok1, user: user1 } = (await signupRes.json()) as {
      token: string;
      user: { userId: string; tenantId: string; role: "admin"; email: string; name: string; plantIds: string[] };
    };

    // 1. Brand-new SaaS Free tenant starts with 0 enabled services + uncompleted walkthrough
    const initRes = await sandboxGet(
      new Request("http://localhost:3000/api/sandbox/services", {
        headers: { authorization: `Bearer ${tok1}` }
      })
    );
    expect(initRes.status).toBe(200);
    const initData = (await initRes.json()) as {
      services: Array<{ id: string; enabled: boolean; pinnedToDashboard: boolean; enabledSkills: string[] }>;
      plan: string;
      limits: { maxServices: number; maxAgents: number; maxConnectors: number };
      workspaceProfile: { onboardingCompleted: boolean };
      overviewAgent: { activeServiceIds: string[]; disabledServiceIds: string[] };
    };
    expect(initData.plan).toBe("free");
    expect(initData.limits.maxServices).toBe(3);
    expect(initData.limits.maxConnectors).toBe(5);
    expect(initData.workspaceProfile.onboardingCompleted).toBe(false);
    expect(initData.overviewAgent.activeServiceIds).toEqual([]);
    expect(initData.overviewAgent.disabledServiceIds.length).toBe(8);

    // 1b. Completing walkthrough with >3 services on Free plan is blocked (403)
    const tooManyRes = await sandboxPost(
      new Request("http://localhost:3000/api/sandbox/services", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${tok1}`
        },
        body: JSON.stringify({
          action: "complete_onboarding",
          goal: "KPIs, workflows and board",
          serviceIds: ["board", "dashboards", "workflows", "connectors"]
        })
      })
    );
    expect(tooManyRes.status).toBe(403);

    // Complete walkthrough with 3 services on Free plan
    const onboardRes = await sandboxPost(
      new Request("http://localhost:3000/api/sandbox/services", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${tok1}`
        },
        body: JSON.stringify({
          action: "complete_onboarding",
          goal: "Track OEE dashboards and automate workflow alerts",
          teamSize: "2-10",
          serviceIds: ["board", "dashboards", "workflows"]
        })
      })
    );
    expect(onboardRes.status).toBe(200);
    const onboardData = (await onboardRes.json()) as {
      workspaceProfile: { onboardingCompleted: boolean; pinnedA2UI: unknown[] };
      overviewAgent: { activeServiceIds: string[] };
    };
    expect(onboardData.workspaceProfile.onboardingCompleted).toBe(true);
    expect(onboardData.workspaceProfile.pinnedA2UI.length).toBe(1);
    expect(onboardData.overviewAgent.activeServiceIds.sort()).toEqual([
      "board",
      "dashboards",
      "workflows"
    ]);

    // 2. Reject assigning another service's skill onto dashboards
    const badSkillRes = await sandboxPost(
      new Request("http://localhost:3000/api/sandbox/services", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${tok1}`
        },
        body: JSON.stringify({
          serviceId: "dashboards",
          enabledSkills: ["workflows.dag_authoring"]
        })
      })
    );
    expect(badSkillRes.status).toBe(400);

    // 3. Adding a 4th service on Free plan is blocked (403); remove workflows first, then add monitoring
    const overCapRes = await sandboxPost(
      new Request("http://localhost:3000/api/sandbox/services", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${tok1}`
        },
        body: JSON.stringify({
          serviceId: "monitoring",
          enabled: true,
          pinnedToDashboard: true
        })
      })
    );
    expect(overCapRes.status).toBe(403);

    const skillTrimRes = await sandboxPost(
      new Request("http://localhost:3000/api/sandbox/services", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${tok1}`
        },
        body: JSON.stringify({
          serviceId: "dashboards",
          enabledSkills: ["dashboards.semantic_kpi", "dashboards.spec_builder"]
        })
      })
    );
    expect(skillTrimRes.status).toBe(200);

    const delWfRes = await sandboxDelete(
      new Request("http://localhost:3000/api/sandbox/services?serviceId=workflows", {
        method: "DELETE",
        headers: {
          origin: "http://localhost:3000",
          authorization: `Bearer ${tok1}`
        }
      })
    );
    expect(delWfRes.status).toBe(200);

    const addMonRes = await sandboxPost(
      new Request("http://localhost:3000/api/sandbox/services", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${tok1}`
        },
        body: JSON.stringify({
          serviceId: "monitoring",
          enabled: true,
          pinnedToDashboard: true
        })
      })
    );
    expect(addMonRes.status).toBe(200);

    // 4. Logout & Login: verify persistence and Acme tenant isolation
    await logoutPost(
      new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: { origin: "http://localhost:3000", authorization: `Bearer ${tok1}` }
      })
    );
    const loginRes = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email, password })
      })
    );
    const { token: tok2 } = (await loginRes.json()) as { token: string };

    const persistedRes = await sandboxGet(
      new Request("http://localhost:3000/api/sandbox/services", {
        headers: { authorization: `Bearer ${tok2}` }
      })
    );
    const persisted = (await persistedRes.json()) as {
      services: Array<{ id: string; enabled: boolean; enabledSkills: string[] }>;
      overviewAgent: { activeServiceIds: string[]; disabledServiceIds: string[]; activeSkills: string[] };
    };
    expect(persisted.overviewAgent.activeServiceIds.sort()).toEqual([
      "board",
      "dashboards",
      "monitoring"
    ]);
    expect(persisted.overviewAgent.disabledServiceIds).toContain("workflows");
    const dashRow = persisted.services.find((s) => s.id === "dashboards")!;
    expect(dashRow.enabledSkills.sort()).toEqual([
      "dashboards.semantic_kpi",
      "dashboards.spec_builder"
    ]);
    expect(persisted.overviewAgent.activeSkills).not.toContain("dashboards.compare_periods");

    // 5. Strict service agent isolation + overview awareness on this customized tenant
    // Policy engine enforces dashboard skill subset & rejects out-of-service tools
    const dashCaps = computeAgentCapabilities(
      persisted.services as unknown as Parameters<typeof computeAgentCapabilities>[0],
      "dashboards"
    );
    expect(dashCaps.allowedToolNames.has("query_metric")).toBe(true);
    expect(dashCaps.allowedToolNames.has("compare_metrics")).toBe(false);
    expect(dashCaps.allowedToolNames.has("paas.trigger_workflow")).toBe(false);
    expect(dashCaps.allowedToolNames.has("draft_work_order")).toBe(false);
    expect(dashCaps.allowedToolNames.has("get_active_alarms")).toBe(false);

    const { getWebAdministrativeDb } = await import("../apps/web/src/lib/db");
    const adminDb = await getWebAdministrativeDb();

    const allowedMetric = await executeToolWithPolicy(
      "query_metric",
      { metric: "oee", range: "7d" },
      { db: adminDb, user: user1, requestId: "req-iso-ok" },
      { allowedToolNamesOverride: dashCaps.allowedToolNames, serviceScopeLabel: "AI Dashboard Agent (dashboards)" }
    );
    expect(allowedMetric.status).toBe("allowed");

    const deniedCompare = await executeToolWithPolicy(
      "compare_metrics",
      { metricA: "oee", metricB: "availability", range: "7d" },
      { db: adminDb, user: user1, requestId: "req-iso-disabled-skill" },
      { allowedToolNamesOverride: dashCaps.allowedToolNames, serviceScopeLabel: "AI Dashboard Agent (dashboards)" }
    );
    expect(deniedCompare.status).toBe("denied");
    expect(deniedCompare.denialReason).toContain("AI Dashboard Agent");

    for (const foreignTool of ["draft_work_order", "paas.trigger_workflow", "get_active_alarms"]) {
      const denied = await executeToolWithPolicy(
        foreignTool,
        {},
        { db: adminDb, user: user1, requestId: `req-iso-${foreignTool}` },
        { allowedToolNamesOverride: dashCaps.allowedToolNames, serviceScopeLabel: "AI Dashboard Agent (dashboards)" }
      );
      expect(denied.status).toBe("denied");
    }

    // runAgentTurn for isolated dashboards agent refuses workflow requests without calling foreign tools
    const foreignChatRes = await chatPost(
      new Request("http://localhost:3000/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${tok2}`
        },
        body: JSON.stringify({
          serviceId: "dashboards",
          message: "Create and trigger a workflow for active monitoring alerts"
        })
      })
    );
    expect(foreignChatRes.status).toBe(200);
    const foreignChat = (await foreignChatRes.json()) as {
      answer: string;
      toolCalls: unknown[];
      activeAgent: { scopeId: string; isOverview: boolean };
    };
    expect(foreignChat.activeAgent.scopeId).toBe("dashboards");
    expect(foreignChat.activeAgent.isOverview).toBe(false);
    expect(foreignChat.toolCalls).toEqual([]);
    expect(foreignChat.answer).toContain("Semantic Dashboards");
    expect(foreignChat.answer).toContain("Overview");
    expect(foreignChat.answer.toLowerCase()).not.toContain("skills");
    expect(foreignChat.answer.toLowerCase()).not.toContain("strictly scoped");

    // Asking a removed service agent explicitly returns unavailable notice
    const disabledTurn = await runAgentTurn({
      db: adminDb,
      user: user1,
      serviceId: "workflows",
      message: "List my workflows"
    });
    expect(disabledTurn.toolCalls).toEqual([]);
    expect(disabledTurn.answer).toContain("not added to your workspace");

    // /api/ai/changes blocks out-of-service proposal & allows dashboards proposal
    const foreignChangeRes = await aiChangesPost(
      new Request("http://localhost:3000/api/ai/changes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${tok2}`
        },
        body: JSON.stringify({
          mode: "propose",
          scope: "screen",
          pathname: "/dashboards",
          serviceId: "dashboards",
          prompt: "Create workflow: when vibration exceeds 7 notify team"
        })
      })
    );
    expect(foreignChangeRes.status).toBe(403);

    const ownChangeRes = await aiChangesPost(
      new Request("http://localhost:3000/api/ai/changes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${tok2}`
        },
        body: JSON.stringify({
          mode: "propose",
          scope: "screen",
          pathname: "/dashboards",
          serviceId: "dashboards",
          prompt: "Add an energy_kwh widget to dashboard"
        })
      })
    );
    expect(ownChangeRes.status).toBe(200);
    const ownChange = (await ownChangeRes.json()) as { proposal: { targetType: string } };
    expect(ownChange.proposal.targetType).toBe("dashboard");

    // 6. Overview Agent knows active vs removed services across the customized sandbox
    const overviewTurn = await runAgentTurn({
      db: adminDb,
      user: user1,
      serviceId: "overview",
      message: "Show overview of my installed sandbox services and active skills"
    });
    expect(overviewTurn.activeAgent?.isOverview).toBe(true);
    expect(overviewTurn.answer).toContain("Workspace Overview");
    expect(overviewTurn.answer).toContain("Monitoring & Alerts");
    expect(overviewTurn.answer).toContain("Semantic Dashboards");
    expect(overviewTurn.answer.toLowerCase()).not.toContain("active skills");
    // Workflows was removed from this tenant's sandbox, so Overview Agent never runs workflow tools
    expect(overviewTurn.toolCalls.some((tc) => tc.toolName === "paas.list_workflows")).toBe(false);
    // Monitoring was added to this tenant's sandbox, so Overview Agent queries alerts across services
    expect(overviewTurn.toolCalls.some((tc) => tc.toolName === "paas.list_alerts")).toBe(true);
    expect(overviewTurn.toolCalls.some((tc) => tc.toolName === "query_metric")).toBe(true);

    // 7. Acme tenant still has its own independent workspace unaffected by Nova changes
    const acmeLogin = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "admin@acme.demo", password: DEMO_PASSWORD })
      })
    );
    const { token: acmeTok } = (await acmeLogin.json()) as { token: string };
    const acmeSbx = (await (
      await sandboxGet(
        new Request("http://localhost:3000/api/sandbox/services", {
          headers: { authorization: `Bearer ${acmeTok}` }
        })
      )
    ).json()) as { overviewAgent: { activeServiceIds: string[] } };
    expect(acmeSbx.overviewAgent.activeServiceIds).toContain("workflows");
  });
});
