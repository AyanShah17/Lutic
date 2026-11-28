import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildWorkflowFromPrompt,
  createDbConnection,
  executeWorkflow,
  expandRagQueries,
  hybridSearchDocuments,
  resetGlobalDbForTests,
  seedDatabase,
  workflows,
  type DbConnection
} from "@lutic/core";
import { executeToolWithPolicy, resetRateLimits } from "@lutic/agent";
import { POST as signupPost } from "../apps/web/src/app/api/auth/signup/route";
import { POST as loginPost } from "../apps/web/src/app/api/auth/login/route";
import { POST as sandboxPost, GET as sandboxGet } from "../apps/web/src/app/api/sandbox/services/route";
import { POST as connectorsPost, GET as connectorsGet } from "../apps/web/src/app/api/connectors/route";
import { POST as chatPost } from "../apps/web/src/app/api/chat/route";
import { POST as a2uiPost, GET as a2uiGet } from "../apps/web/src/app/api/ai/a2ui/route";
import { middleware } from "../apps/web/src/middleware";
import { verifyCsrfOrigin } from "../apps/web/src/lib/auth";
import { POST as licensePost, DELETE as licenseDelete } from "../apps/web/src/app/api/license/route";
import { GET as diagnosticsGet } from "../apps/web/src/app/api/admin/diagnostics/route";
import { POST as oauthAuthorizePost } from "../apps/web/src/app/api/connectors/oauth/authorize/route";
import { POST as changePasswordPost } from "../apps/web/src/app/api/auth/change-password/route";
import { POST as workflowAiBuildPost } from "../apps/web/src/app/api/workflows/ai-build/route";
import { POST as uploadsPost } from "../apps/web/src/app/api/uploads/route";

const ROOT = path.resolve(__dirname, "..");

describe("Production Cybersecurity, Free-Tier Quotas, Walkthrough, A2UI, RAG & Pipelines", () => {
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

  it("enforces Cloudflare origin-lock secret header and Clerk-only production auth", async () => {
    vi.stubEnv("LUTIC_ORIGIN_LOCK_SECRET", "super-secret-origin-token-2026");

    const blockedRes = middleware(new NextRequest("https://lutic.app/api/connectors"));
    expect(blockedRes?.status).toBe(403);

    const wrongRes = middleware(
      new NextRequest("https://lutic.app/dashboard", {
        headers: { "x-lutic-origin-secret": "wrong-secret" }
      })
    );
    expect(wrongRes?.status).toBe(403);

    const liveRes = middleware(new NextRequest("https://lutic.app/api/health/live"));
    expect(liveRes?.status).not.toBe(403);

    // Host header spoofing against /api/health is rejected when origin lock secret is set
    const healthSpoofRes = middleware(new NextRequest("http://127.0.0.1:3000/api/health"));
    expect(healthSpoofRes?.status).toBe(403);

    const allowedRes = middleware(
      new NextRequest("https://lutic.app/api/connectors", {
        headers: { "x-lutic-origin-secret": "super-secret-origin-token-2026" }
      })
    );
    expect(allowedRes?.status).toBe(200);

    // Cross-site sec-fetch-site header is rejected by CSRF guard even when Origin is omitted
    expect(() =>
      verifyCsrfOrigin(
        new Request("https://lutic.app/api/board", {
          method: "POST",
          headers: { host: "lutic.app", "sec-fetch-site": "cross-site" }
        })
      )
    ).toThrow("Cross-site state-changing request rejected");

    // Clerk-only mode blocks local password auth + change-password endpoints
    vi.stubEnv("LUTIC_CLERK_ONLY", "true");
    const clerkChangePw = await changePasswordPost(
      new Request("http://localhost:3000/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ currentPassword: "old", newPassword: "NewStrongPassword#2026" })
      })
    );
    expect(clerkChangePw.status).toBe(403);
    const clerkLoginRes = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "anyone@example.com", password: "Password123!" })
      })
    );
    expect(clerkLoginRes.status).toBe(403);

    const clerkSignupRes = await signupPost(
      new Request("http://localhost:3000/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          name: "Test User",
          email: "clerk.only@example.com",
          password: "Password123!"
        })
      })
    );
    expect(clerkSignupRes.status).toBe(403);
  });

  it("enforces Free-plan 0-service walkthrough, 3 services/agents max, 5 connectors max, A2UI persistence, and API/AI/tool daily+time rate limits", async () => {
    const email = "free.tier.user@lutic.test";
    const password = "FreeTierStrongPassword#2026";

    const signupRes = await signupPost(
      new Request("http://localhost:3000/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          name: "Free User",
          workspaceName: "Free Starter",
          email,
          password
        })
      })
    );
    expect(signupRes.status).toBe(201);
    const { token, user } = (await signupRes.json()) as {
      token: string;
      user: { userId: string; tenantId: string; role: "admin"; email: string; name: string; plantIds: string[] };
    };

    // 1. Walkthrough starts with 0 enabled services
    const initGet = await sandboxGet(
      new Request("http://localhost:3000/api/sandbox/services", {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    const initJson = (await initGet.json()) as {
      plan: string;
      workspaceProfile: { onboardingCompleted: boolean };
      overviewAgent: { activeServiceIds: string[] };
    };
    expect(initJson.plan).toBe("free");
    expect(initJson.workspaceProfile.onboardingCompleted).toBe(false);
    expect(initJson.overviewAgent.activeServiceIds).toEqual([]);

    // Complete walkthrough with 3 services (board, dashboards, workflows)
    const onboardRes = await sandboxPost(
      new Request("http://localhost:3000/api/sandbox/services", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          action: "complete_onboarding",
          goal: "Build OEE dashboards and automated workflow alerts",
          serviceIds: ["board", "dashboards", "workflows"]
        })
      })
    );
    expect(onboardRes.status).toBe(200);

    // 4th service blocked with 403
    const fourthServiceRes = await sandboxPost(
      new Request("http://localhost:3000/api/sandbox/services", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ serviceId: "connectors", enabled: true })
      })
    );
    expect(fourthServiceRes.status).toBe(403);

    // 2. Connectors limit: 5 allowed, 6th returns 403
    for (let i = 1; i <= 5; i += 1) {
      const cRes = await connectorsPost(
        new Request("http://localhost:3000/api/connectors", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            name: `Slack Workspace ${i}`,
            kind: "slack",
            endpointUrl: `https://slack.com/api/${i}`
          })
        })
      );
      expect(cRes.status).toBe(201);
    }
    const sixthConn = await connectorsPost(
      new Request("http://localhost:3000/api/connectors", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: "Sixth Connector Blocked",
          kind: "github",
          endpointUrl: "https://api.github.com"
        })
      })
    );
    expect(sixthConn.status).toBe(403);

    const connUsageRes = await connectorsGet(
      new Request("http://localhost:3000/api/connectors", {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    const connUsage = (await connUsageRes.json()) as {
      usage: { connectors: number; maxConnectors: number };
    };
    expect(connUsage.usage).toEqual({ connectors: 5, maxConnectors: 5 });

    // 3. A2UI generation, pinning & persistence
    const a2uiGenRes = await a2uiPost(
      new Request("http://localhost:3000/api/ai/a2ui", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          action: "generate",
          prompt: "Show OEE chart and triage intake form",
          pin: true
        })
      })
    );
    expect(a2uiGenRes.status).toBe(200);
    const a2uiData = (await a2uiGenRes.json()) as {
      spec: { title: string; components: Array<{ type: string }> };
      pinnedA2UI: Array<{ title: string }>;
    };
    expect(a2uiData.spec.components.some((c) => c.type === "chart")).toBe(true);
    expect(a2uiData.spec.components.some((c) => c.type === "form")).toBe(true);

    const a2uiPersistedRes = await a2uiGet(
      new Request("http://localhost:3000/api/ai/a2ui", {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    const persistedA2ui = (await a2uiPersistedRes.json()) as {
      pinnedA2UI: Array<{ title: string }>;
    };
    expect(persistedA2ui.pinnedA2UI.length).toBeGreaterThanOrEqual(2);

    // 3b. Stored XSS links in A2UI specs are rejected
    for (const unsafeHref of ["javascript:alert(1)", "//evil.example/phish"]) {
      const badA2uiRes = await a2uiPost(
        new Request("http://localhost:3000/api/ai/a2ui", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            action: "pin",
            spec: {
              id: "xss-test",
              title: "Test",
              subtitle: "",
              prompt: "test",
              createdAt: new Date().toISOString(),
              layout: "grid",
              components: [
                {
                  id: "c1",
                  type: "action_bar",
                  title: "Actions",
                  actions: [{ label: "Click", href: unsafeHref }]
                }
              ]
            }
          })
        })
      );
      expect(badA2uiRes.status).toBe(400);
    }

    // 3c. Tenant-vs-Platform boundary: Free admin cannot invoke license management or host diagnostics
    const freeLicPost = await licensePost(
      new Request("http://localhost:3000/api/license", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ key: "FAKE-KEY" })
      })
    );
    expect(freeLicPost.status).toBe(403);

    const freeLicDel = await licenseDelete(
      new Request("http://localhost:3000/api/license", {
        method: "DELETE",
        headers: { origin: "http://localhost:3000", authorization: `Bearer ${token}` }
      })
    );
    expect(freeLicDel.status).toBe(403);

    const freeDiagRes = await diagnosticsGet(
      new Request("http://localhost:3000/api/admin/diagnostics", {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    expect(freeDiagRes.status).toBe(403);

    // 3d. SSRF & connector cap checks on OAuth authorize
    for (const unsafeUrl of [
      "javascript:alert(1)",
      "http://169.254.169.254/opc/v2/instance/",
      "http://litellm:4000/v1"
    ]) {
      const ssrfOauth = await oauthAuthorizePost(
        new Request("http://localhost:3000/api/connectors/oauth/authorize", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            slug: "custom-oauth",
            authorizationUrl: unsafeUrl,
            tokenUrl: "https://auth.example.com/token",
            clientId: "cid-1"
          })
        })
      );
      expect(ssrfOauth.status).toBe(400);
    }

    // At 5/5 connectors, OAuth authorize is also rejected with 403
    const overConnOauth = await oauthAuthorizePost(
      new Request("http://localhost:3000/api/connectors/oauth/authorize", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          slug: "github",
          clientId: "cid-gh"
        })
      })
    );
    expect(overConnOauth.status).toBe(403);

    // 4. AI rate limit (Free plan allows 10/min; we used 1 in a2ui generate above -> 9 more pass, 11th returns 429)
    let got429 = false;
    for (let i = 0; i < 11; i += 1) {
      const chatRes = await chatPost(
        new Request("http://localhost:3000/api/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            serviceId: "overview",
            message: `Quick status check ${i}`
          })
        })
      );
      if (chatRes.status === 429) {
        got429 = true;
        expect(chatRes.headers.get("Retry-After")).toBeTruthy();
        break;
      }
    }
    expect(got429).toBe(true);

    // Workflows ai-build shares AI rate limit bucket -> returns 429 with Retry-After once exhausted
    const aiBuild429 = await workflowAiBuildPost(
      new Request("http://localhost:3000/api/workflows/ai-build", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ prompt: "Alert on vibration spike" })
      })
    );
    expect(aiBuild429.status).toBe(429);
    expect(aiBuild429.headers.get("Retry-After")).toBeTruthy();

    // Uploads enforces API rate limit (30/min on Free plan)
    let upload429 = false;
    for (let i = 0; i < 32; i += 1) {
      const upRes = await uploadsPost(
        new Request("http://localhost:3000/api/uploads", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ name: "note.txt", text: "ok" })
        })
      );
      if (upRes.status === 429) {
        upload429 = true;
        expect(upRes.headers.get("Retry-After")).toBeTruthy();
        break;
      }
    }
    expect(upload429).toBe(true);

    // 5. Agent tool calls per-minute & daily caps on Free plan
    const { getWebAdministrativeDb } = await import("../apps/web/src/lib/db");
    const adminDb = await getWebAdministrativeDb();
    await resetRateLimits(adminDb);

    // Default Free per-minute tool cap is 12 -> 13th call denied
    let toolPerMinDenied = false;
    for (let i = 0; i < 14; i += 1) {
      const res = await executeToolWithPolicy(
        "query_metric",
        { metric: "oee", range: "7d" },
        { db: adminDb, user, requestId: `req-min-${i}` }
      );
      if (res.status === "denied") {
        toolPerMinDenied = true;
        expect(res.denialReason).toContain("rate limit");
        break;
      }
    }
    expect(toolPerMinDenied).toBe(true);

    // Daily tool cap enforced cleanly
    await resetRateLimits(adminDb);
    const okDaily = await executeToolWithPolicy(
      "query_metric",
      { metric: "oee", range: "7d" },
      { db: adminDb, user, requestId: "req-day-1" },
      { userRateLimit: 100, dailyToolLimit: 1 }
    );
    expect(okDaily.status).toBe("allowed");
    const deniedDaily = await executeToolWithPolicy(
      "query_metric",
      { metric: "oee", range: "7d" },
      { db: adminDb, user, requestId: "req-day-2" },
      { userRateLimit: 100, dailyToolLimit: 1 }
    );
    expect(deniedDaily.status).toBe("denied");
    expect(deniedDaily.denialReason).toContain("Daily tool call limit");
  });

  it("supports upgraded multi-query RAG with neighbor context and verified DAG workflow pipeline execution", async () => {
    const queries = expandRagQueries("vibration overheat lockout procedures");
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.join(" ").toLowerCase()).toContain("bearing");

    const rag = await hybridSearchDocuments(conn.db, {
      tenantId: "tenant-acme",
      query: "vibration overheat bearing replacement",
      limit: 3
    });
    expect(rag.chunks.length).toBeGreaterThan(0);
    expect(rag.retrievalMeta?.techniques).toContain("multi_query_fts_bm25");
    expect(rag.retrievalMeta?.techniques).toContain("neighbor_chunk_context");

    // End-to-end DAG workflow pipeline execution
    const draft = buildWorkflowFromPrompt(
      "When mach-l3-filler-01 vibration exceeds 7.5 check alarms and notify supervisors"
    );
    const wfId = "wf-prod-verify-pipeline";
    await conn.db.insert(workflows).values({
      id: wfId,
      tenantId: "tenant-acme",
      plantId: "plant-detroit",
      name: draft.name,
      description: draft.description,
      triggerType: draft.triggerType,
      triggerConfig: draft.triggerConfig,
      definition: draft.definition as unknown as Record<string, unknown>,
      enabled: true,
      currentVersion: 1,
      createdBy: "user-admin"
    });
    const execResult = await executeWorkflow(conn.db, {
      tenantId: "tenant-acme",
      workflowId: wfId,
      triggerSource: "test",
      triggeredBy: "user-admin",
      input: { machineId: "mach-l3-filler-01", vibration: 8.4 }
    });
    expect(execResult.status).toBe("succeeded");
    expect(execResult.stepTraces.length).toBeGreaterThanOrEqual(2);
  });

  it("includes Docker backend network isolation, cloudflared tunnel, and DEPLOY_PRODUCTION.md runbook", () => {
    const compose = fs.readFileSync(path.join(ROOT, "docker-compose.yml"), "utf-8");
    expect(compose).toContain("lutic_backend:");
    expect(compose).toContain("internal: true");
    expect(compose).toContain("cloudflared:");
    expect(compose).toContain("LUTIC_ORIGIN_LOCK_SECRET");
    expect(compose).toContain("LUTIC_CLERK_ONLY");

    const runbook = fs.readFileSync(path.join(ROOT, "DEPLOY_PRODUCTION.md"), "utf-8");
    expect(runbook).toContain("Oracle Cloud Free Tier");
    expect(runbook).toContain("Cloudflare Free Tier");
    expect(runbook).toContain("Clerk");
    expect(runbook).toContain("x-lutic-origin-secret");
    expect(runbook).toContain("LUTIC_ORIGIN_LOCK_SECRET");
  });
});
