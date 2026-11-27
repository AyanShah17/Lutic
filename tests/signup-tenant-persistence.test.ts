import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createDbConnection,
  DEMO_PASSWORD,
  eq,
  resetGlobalDbForTests,
  seedDatabase,
  toolkits,
  type DbConnection
} from "@lutic/core";
import { POST as signupPost } from "../apps/web/src/app/api/auth/signup/route";
import { POST as loginPost } from "../apps/web/src/app/api/auth/login/route";
import { POST as logoutPost } from "../apps/web/src/app/api/auth/logout/route";
import { GET as boardGet, POST as boardPost } from "../apps/web/src/app/api/board/route";
import { GET as workflowsGet, POST as workflowsPost } from "../apps/web/src/app/api/workflows/route";
import { GET as dashboardsGet, POST as dashboardsPost } from "../apps/web/src/app/api/dashboards/route";
import { GET as connectorsGet, POST as connectorsPost } from "../apps/web/src/app/api/connectors/route";

describe("Self-Serve AI SaaS Signup, Dedicated Workspace Provisioning & Cross-Session Persistence", () => {
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

  it("blocks self-serve signup in Enterprise invite-only deployments and rejects duplicate emails", async () => {
    vi.stubEnv("LUTIC_DEPLOYMENT_PLAN", "enterprise");
    const entRes = await signupPost(
      new Request("http://localhost:3000/api/auth/signup", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000"
        },
        body: JSON.stringify({
          name: "Enterprise Lead",
          workspaceName: "Blocked Corp",
          email: "blocked@ent.example.com",
          password: "SuperSecurePassword123!"
        })
      })
    );
    expect(entRes.status).toBe(403);

    vi.stubEnv("LUTIC_DEPLOYMENT_PLAN", "free");
    const dupRes = await signupPost(
      new Request("http://localhost:3000/api/auth/signup", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000"
        },
        body: JSON.stringify({
          name: "Duplicate Admin",
          workspaceName: "Dup",
          email: "admin@acme.demo",
          password: "SuperSecurePassword123!"
        })
      })
    );
    expect(dupRes.status).toBe(409);
  });

  it("provisions an isolated tenant on signup and persists boards, workflows, dashboards, and connectors across logout/login", async () => {
    const email = "founder.nova@novalabs.ai";
    const password = "NovaStudioPassword#2026";

    // 1. Self-serve signup creates tenant, toolkits, native connectors, starter board/workflow/dashboard
    const signupRes = await signupPost(
      new Request("http://localhost:3000/api/auth/signup", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000"
        },
        body: JSON.stringify({
          name: "Nova Founder",
          workspaceName: "Nova AI Studio",
          email,
          password
        })
      })
    );
    expect(signupRes.status).toBe(201);
    expect(signupRes.headers.get("set-cookie") ?? "").toContain("lutic_session=");

    const signupBody = (await signupRes.json()) as {
      user: { userId: string; tenantId: string; role: string; plantIds: string[]; email: string };
      token: string;
    };
    expect(signupBody.user.role).toBe("admin");
    expect(signupBody.user.tenantId).not.toBe("tenant-acme");
    expect(signupBody.user.plantIds).toHaveLength(1);
    const firstToken = signupBody.token;

    // Core toolkits are installed for the newly provisioned tenant
    const { getWebAdministrativeDb } = await import("../apps/web/src/lib/db");
    const adminDb = await getWebAdministrativeDb();
    const tenantToolkits = await adminDb
      .select()
      .from(toolkits)
      .where(eq(toolkits.tenantId, signupBody.user.tenantId));
    expect(tenantToolkits.length).toBeGreaterThanOrEqual(5);

    // 2. Starter artifacts are immediately available
    const [initBoard, initWf, initDash, initConn] = await Promise.all([
      boardGet(
        new Request("http://localhost:3000/api/board", {
          headers: { authorization: `Bearer ${firstToken}` }
        })
      ),
      workflowsGet(
        new Request("http://localhost:3000/api/workflows", {
          headers: { authorization: `Bearer ${firstToken}` }
        })
      ),
      dashboardsGet(
        new Request("http://localhost:3000/api/dashboards", {
          headers: { authorization: `Bearer ${firstToken}` }
        })
      ),
      connectorsGet(
        new Request("http://localhost:3000/api/connectors", {
          headers: { authorization: `Bearer ${firstToken}` }
        })
      )
    ]);
    expect(initBoard.status).toBe(200);
    expect(((await initBoard.json()) as { issues: unknown[] }).issues.length).toBeGreaterThanOrEqual(3);
    expect(initWf.status).toBe(200);
    expect(((await initWf.json()) as { workflows: unknown[] }).workflows.length).toBeGreaterThanOrEqual(1);
    expect(initDash.status).toBe(200);
    expect(((await initDash.json()) as { dashboards: unknown[] }).dashboards.length).toBeGreaterThanOrEqual(1);
    expect(initConn.status).toBe(200);
    expect(((await initConn.json()) as { connectors: unknown[] }).connectors).toEqual([]);

    // 3. User creates persistent custom artifacts across services inside their tenant
    const createdBoardRes = await boardPost(
      new Request("http://localhost:3000/api/board", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${firstToken}`
        },
        body: JSON.stringify({
          title: "Persistent Nova Billing Agent Task",
          priority: "urgent",
          category: "automation",
          status: "todo"
        })
      })
    );
    expect(createdBoardRes.status).toBe(201);
    const createdBoard = (await createdBoardRes.json()) as { issue: { id: string } };

    const createdWfRes = await workflowsPost(
      new Request("http://localhost:3000/api/workflows", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${firstToken}`
        },
        body: JSON.stringify({
          name: "Persistent Nova Canvas DAG",
          description: "Persists across logout/login",
          triggerType: "manual",
          nodes: [
            { id: "n1", type: "trigger", label: "Webhook Trigger", config: {}, position: { x: 80, y: 120 } },
            { id: "n2", type: "ai", label: "Route Invoice", config: {}, position: { x: 320, y: 120 } }
          ],
          edges: [{ id: "e1", source: "n1", target: "n2" }]
        })
      })
    );
    expect(createdWfRes.status).toBe(201);
    const createdWf = (await createdWfRes.json()) as { workflowId: string };

    const createdDashRes = await dashboardsPost(
      new Request("http://localhost:3000/api/dashboards", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${firstToken}`
        },
        body: JSON.stringify({
          title: "Persistent Nova Revenue AI Board",
          description: "Custom dashboard persisted per tenant"
        })
      })
    );
    expect(createdDashRes.status).toBe(201);
    const createdDash = (await createdDashRes.json()) as { dashboardId: string };

    const createdConnRes = await connectorsPost(
      new Request("http://localhost:3000/api/connectors", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          authorization: `Bearer ${firstToken}`
        },
        body: JSON.stringify({
          name: "Nova Custom Webhook",
          kind: "webhook",
          endpointUrl: "https://hooks.novalabs.ai/events"
        })
      })
    );
    expect(createdConnRes.status).toBe(201);
    const createdConn = (await createdConnRes.json()) as { id: string };

    // 4. Logout revokes old token
    const logoutRes = await logoutPost(
      new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          authorization: `Bearer ${firstToken}`
        }
      })
    );
    expect(logoutRes.status).toBe(200);

    const revokedGet = await boardGet(
      new Request("http://localhost:3000/api/board", {
        headers: { authorization: `Bearer ${firstToken}` }
      })
    );
    expect(revokedGet.status).toBe(401);

    // 5. Log back in in a brand-new session with the user's signup credentials
    const loginRes = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000"
        },
        body: JSON.stringify({ email, password })
      })
    );
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as {
      user: { userId: string; tenantId: string };
      token: string;
    };
    expect(loginBody.user.userId).toBe(signupBody.user.userId);
    expect(loginBody.user.tenantId).toBe(signupBody.user.tenantId);

    // 6. Verify every item from session 1 persisted cleanly into session 2
    const [persistedBoard, persistedWf, persistedDash, persistedConn] = await Promise.all([
      boardGet(
        new Request("http://localhost:3000/api/board", {
          headers: { authorization: `Bearer ${loginBody.token}` }
        })
      ).then((r) => r.json() as Promise<{ issues: Array<{ id: string }> }>),
      workflowsGet(
        new Request("http://localhost:3000/api/workflows", {
          headers: { authorization: `Bearer ${loginBody.token}` }
        })
      ).then((r) => r.json() as Promise<{ workflows: Array<{ id: string }> }>),
      dashboardsGet(
        new Request("http://localhost:3000/api/dashboards", {
          headers: { authorization: `Bearer ${loginBody.token}` }
        })
      ).then((r) => r.json() as Promise<{ dashboards: Array<{ id: string }> }>),
      connectorsGet(
        new Request("http://localhost:3000/api/connectors", {
          headers: { authorization: `Bearer ${loginBody.token}` }
        })
      ).then((r) => r.json() as Promise<{ connectors: Array<{ id: string }> }>)
    ]);

    expect(persistedBoard.issues.some((i) => i.id === createdBoard.issue.id)).toBe(true);
    expect(persistedWf.workflows.some((w) => w.id === createdWf.workflowId)).toBe(true);
    expect(persistedDash.dashboards.some((d) => d.id === createdDash.dashboardId)).toBe(true);
    expect(persistedConn.connectors.some((c) => c.id === createdConn.id)).toBe(true);

    // 7. Strict cross-tenant isolation: Acme tenant cannot see Nova Studio artifacts
    const acmeLogin = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000"
        },
        body: JSON.stringify({ email: "admin@acme.demo", password: DEMO_PASSWORD })
      })
    );
    const { token: acmeToken } = (await acmeLogin.json()) as { token: string };
    const acmeBoard = (await (
      await boardGet(
        new Request("http://localhost:3000/api/board", {
          headers: { authorization: `Bearer ${acmeToken}` }
        })
      )
    ).json()) as { issues: Array<{ id: string }> };
    expect(acmeBoard.issues.some((i) => i.id === createdBoard.issue.id)).toBe(false);
  });
});
