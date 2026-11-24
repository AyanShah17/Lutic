import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  alertEvents,
  alertRules,
  and,
  can,
  connectors,
  connectorSyncLogs,
  createDbConnection,
  dashboardVersions,
  DEMO_PASSWORD,
  eq,
  getPermissionsForRole,
  machineStatus,
  notifications,
  PERMISSIONS,
  queueMessages,
  resetLicenseCacheForTests,
  runRuntimeTick,
  seedDatabase,
  shouldSkipAutoRuntime,
  sql,
  stopBackgroundRuntime,
  withTenantScope,
  workflowRuns,
  workflows,
  type DbConnection,
  type SessionUser
} from "@lutic/core";
import {
  handleLicenseRequest,
  startLicenseServer,
  resetLicenseStore
} from "./fixtures/mock-license-server";
import { POST as loginPost } from "../apps/web/src/app/api/auth/login/route";
import { POST as demoSwitchPost } from "../apps/web/src/app/api/auth/demo-switch/route";
import { GET as sessionGet } from "../apps/web/src/app/api/auth/session/route";
import { POST as metricsQueryPost } from "../apps/web/src/app/api/metrics/query/route";
import { POST as dashboardsPost } from "../apps/web/src/app/api/dashboards/route";
import { PUT as dashboardPut } from "../apps/web/src/app/api/dashboards/[id]/route";
import {
  GET as dashboardVersionsGet,
  POST as dashboardVersionsPost
} from "../apps/web/src/app/api/dashboards/[id]/versions/route";
import { GET as machinesGet } from "../apps/web/src/app/api/machines/route";
import {
  GET as licenseGet,
  POST as licensePost,
  DELETE as licenseDelete
} from "../apps/web/src/app/api/license/route";
import { GET as healthGet } from "../apps/web/src/app/api/health/route";
import { middleware } from "../apps/web/src/middleware";
import { getWebAdministrativeDb } from "../apps/web/src/lib/db";

let licenseServer: { port: number; stop: () => Promise<void> } | null = null;
let licenseUrl: string;
const origFetch = globalThis.fetch;

beforeAll(async () => {
  process.env.DATABASE_URL = "memory://";
  process.env.ALLOW_DEMO_SWITCH = "true";
  delete process.env.LICENSE_ENFORCE;
  delete process.env.LUTIC_LICENSE_KEY;
  resetLicenseStore();
  resetLicenseCacheForTests();
  try {
    licenseServer = await startLicenseServer(0);
    licenseUrl = `http://127.0.0.1:${licenseServer.port}`;
    await origFetch(`${licenseUrl}/health`);
  } catch {
    await licenseServer?.stop().catch(() => {});
    licenseServer = null;
    // Restricted sandbox blocks TCP loopback connect (EPERM); route test server URL to real handleLicenseRequest
    licenseUrl = "http://license-server.local";
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const urlStr =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (urlStr.startsWith(licenseUrl)) {
        const req =
          input instanceof Request
            ? input
            : new Request(urlStr, init);
        return handleLicenseRequest(req);
      }
      return origFetch(input, init);
    }) as typeof fetch;
  }
  process.env.LICENSE_SERVER_URL = licenseUrl;
  await getWebAdministrativeDb();
});

afterAll(async () => {
  globalThis.fetch = origFetch;
  delete process.env.LICENSE_ENFORCE;
  delete process.env.COOKIE_SECURE;
  stopBackgroundRuntime();
  await licenseServer?.stop();
});

describe("M1 Feature 1: Expanded DB Schema, RLS & Idempotent Seed", () => {
  let conn: DbConnection;

  beforeAll(async () => {
    conn = await createDbConnection("memory://");
    await seedDatabase(conn);
    // Run a second time to verify idempotency
    await seedDatabase(conn);
  });

  afterAll(async () => {
    await conn.close();
  });

  it("creates all 14 new PaaS tables and applies tenant RLS to the 13 tenant-scoped tables", async () => {
    const expectedTables = [
      "workflows",
      "workflow_versions",
      "workflow_runs",
      "connector_connections",
      "connector_triggers",
      "connector_sync_logs",
      "topics",
      "subscriptions",
      "queues",
      "queue_messages",
      "notifications",
      "alert_rules",
      "alert_events",
      "license_state"
    ];

    const tblRes = await conn.db.execute(sql`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `);
    const tableNames = new Set(
      (tblRes.rows as Array<{ tablename: string }>).map((r) => r.tablename)
    );
    for (const tbl of expectedTables) {
      expect(tableNames.has(tbl)).toBe(true);
    }

    const polRes = await conn.db.execute(sql`
      SELECT tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
    `);
    const policyTables = new Set(
      (polRes.rows as Array<{ tablename: string }>).map((r) => r.tablename)
    );
    for (const tbl of expectedTables.filter((t) => t !== "license_state")) {
      expect(policyTables.has(tbl)).toBe(true);
    }
    expect(policyTables.has("license_state")).toBe(false);
  });

  it("enforces tenant isolation via RLS and preserves existing 5 MCP connectors", async () => {
    const mcpRows = await conn.db.select().from(connectors);
    expect(mcpRows.length).toBe(5);

    const acmeWorkflows = await withTenantScope(conn.db, "tenant-acme", (tx) =>
      tx.select().from(workflows)
    );
    expect(acmeWorkflows.some((w) => w.id === "wf-e42-triage")).toBe(true);
    expect(acmeWorkflows.some((w) => w.id === "wf-beta-private")).toBe(false);

    const betaWorkflows = await withTenantScope(conn.db, "tenant-beta", (tx) =>
      tx.select().from(workflows)
    );
    expect(betaWorkflows.map((w) => w.id)).toEqual(["wf-beta-private"]);
  });
});

describe("M1 Feature 2: Unified RBAC Permissions & Client-Safety", () => {
  it("keeps packages/core/src/rbac.ts strictly zod-only for client/mobile bundles", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../packages/core/src/rbac.ts"),
      "utf8"
    );
    const importLines = src
      .split("\n")
      .filter((l) => l.trim().startsWith("import "));
    expect(importLines).toEqual(['import { z } from "zod";']);
  });

  it("enforces expanded permissions across roles via can() and getPermissionsForRole()", () => {
    const makeUser = (role: SessionUser["role"]): SessionUser => ({
      userId: `u-${role}`,
      tenantId: "tenant-acme",
      role,
      plantIds: ["plant-detroit"],
      email: `${role}@acme.demo`,
      name: role
    });

    const engineer = makeUser("engineer");
    expect(can(engineer, "workflow:read")).toBe(true);
    expect(can(engineer, "workflow:execute")).toBe(true);
    expect(can(engineer, "workflow:write")).toBe(false);
    expect(can(engineer, "alert:acknowledge")).toBe(true);
    expect(can(engineer, "license:manage")).toBe(false);

    const analyst = makeUser("analyst");
    expect(can(analyst, "workflow:write")).toBe(true);
    expect(can(analyst, "alert:write")).toBe(true);
    expect(can(analyst, "connector:write")).toBe(false);
    expect(can(analyst, "license:manage")).toBe(false);

    const manager = makeUser("manager");
    expect(can(manager, "notification:write")).toBe(true);
    expect(can(manager, "alert:acknowledge")).toBe(true);
    expect(can(manager, "workflow:execute")).toBe(false);
    expect(can(manager, "queue:write")).toBe(false);

    const admin = makeUser("admin");
    expect(getPermissionsForRole("admin").length).toBe(PERMISSIONS.length);
    for (const perm of PERMISSIONS) {
      expect(can(admin, perm)).toBe(true);
    }
  });
});

describe("M1 Feature 3 & Feature 4: Dashboards 5-Version Cap, Bearer Auth, Cookies & CORS", () => {
  let analystToken = "";
  let adminToken = "";

  it("returns { user, token } on login & demo-switch and respects COOKIE_SECURE", async () => {
    const prevSecure = process.env.COOKIE_SECURE;
    process.env.COOKIE_SECURE = "false";
    const loginRes = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          host: "localhost:3000"
        },
        body: JSON.stringify({
          email: "analyst@acme.demo",
          password: DEMO_PASSWORD
        })
      })
    );
    expect(loginRes.status).toBe(200);
    const loginJson = (await loginRes.json()) as { user: SessionUser; token: string };
    expect(loginJson.user.email).toBe("analyst@acme.demo");
    expect(typeof loginJson.token).toBe("string");
    expect(loginJson.token.length).toBeGreaterThan(20);
    analystToken = loginJson.token;
    const setCookieFalse = loginRes.headers.get("set-cookie") ?? "";
    expect(setCookieFalse).toContain("lutic_session=");
    expect(setCookieFalse.toLowerCase()).not.toContain("; secure");

    process.env.COOKIE_SECURE = "true";
    const demoRes = await demoSwitchPost(
      new Request("http://localhost:3000/api/auth/demo-switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@acme.demo" })
      })
    );
    expect(demoRes.status).toBe(200);
    const demoJson = (await demoRes.json()) as { user: SessionUser; token: string };
    expect(demoJson.user.role).toBe("admin");
    adminToken = demoJson.token;
    const setCookieTrue = demoRes.headers.get("set-cookie") ?? "";
    expect(setCookieTrue.toLowerCase()).toContain("secure");

    if (prevSecure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = prevSecure;
  });

  it("authenticates Bearer tokens, prevents cookie fallback on invalid Bearer, and bypasses CSRF for Bearer", async () => {
    // Valid Bearer without cookie
    const okRes = await sessionGet(
      new Request("http://localhost:3000/api/auth/session", {
        headers: { authorization: `Bearer ${analystToken}` }
      })
    );
    const okJson = (await okRes.json()) as { user: SessionUser | null };
    expect(okJson.user?.email).toBe("analyst@acme.demo");

    // Invalid Bearer WITH valid cookie -> must NOT fall back to cookie
    const noFallbackRes = await sessionGet(
      new Request("http://localhost:3000/api/auth/session", {
        headers: {
          authorization: "Bearer invalid.jwt.token",
          cookie: `lutic_session=${analystToken}`
        }
      })
    );
    const noFallbackJson = (await noFallbackRes.json()) as { user: SessionUser | null };
    expect(noFallbackJson.user).toBeNull();

    // Cross-origin POST without Bearer -> rejected (403)
    const csrfFail = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example.com",
          host: "localhost:3000"
        },
        body: JSON.stringify({
          email: "analyst@acme.demo",
          password: DEMO_PASSWORD
        })
      })
    );
    expect(csrfFail.status).toBe(403);

    // Cross-origin POST WITH Bearer -> allowed (CSRF bypassed)
    const bearerPost = await metricsQueryPost(
      new Request("http://localhost:3000/api/metrics/query", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${analystToken}`,
          origin: "https://evil.example.com",
          host: "localhost:3000"
        },
        body: JSON.stringify({ metric: "oee", range: "7d" })
      })
    );
    expect(bearerPost.status).toBe(200);
  });

  it("handles CORS preflight OPTIONS and response headers via middleware", async () => {
    const preflight = middleware(
      new NextRequest("http://localhost:3000/api/chat", {
        method: "OPTIONS",
        headers: { origin: "http://localhost:8081" }
      })
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:8081"
    );
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
    expect(preflight.headers.get("access-control-allow-headers")).toContain(
      "Authorization"
    );
  });

  it("caps dashboard_versions to newest 5 on PUT and POST /versions", async () => {
    const createRes = await dashboardsPost(
      new Request("http://localhost:3000/api/dashboards", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${analystToken}`
        },
        body: JSON.stringify({
          title: "M1 Cap Test Dashboard",
          fromTemplateId: "dash-tpl-line-overview"
        })
      })
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      dashboardId: string;
      spec: Record<string, unknown>;
    };
    const dashId = created.dashboardId;

    // Perform 7 PUT updates (total versions created = 1..8)
    for (let i = 2; i <= 8; i++) {
      const putRes = await dashboardPut(
        new Request(`http://localhost:3000/api/dashboards/${dashId}`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${analystToken}`
          },
          body: JSON.stringify({
            spec: { ...created.spec, title: `M1 Cap Test v${i}` },
            changeSummary: `Edit #${i}`
          })
        }),
        { params: Promise.resolve({ id: dashId }) }
      );
      expect(putRes.status).toBe(200);
    }

    const db = await getWebAdministrativeDb();
    const dbRowsAfterPut = await db
      .select()
      .from(dashboardVersions)
      .where(eq(dashboardVersions.dashboardId, dashId));
    expect(dbRowsAfterPut.length).toBe(5);

    const getRes = await dashboardVersionsGet(
      new Request(`http://localhost:3000/api/dashboards/${dashId}/versions`, {
        headers: { authorization: `Bearer ${analystToken}` }
      }),
      { params: Promise.resolve({ id: dashId }) }
    );
    const getJson = (await getRes.json()) as {
      versions: Array<{ version: number }>;
    };
    expect(getJson.versions.map((v) => v.version)).toEqual([8, 7, 6, 5, 4]);

    // Restore v5 -> creates v9, still capped at 5 rows
    const restoreRes = await dashboardVersionsPost(
      new Request(`http://localhost:3000/api/dashboards/${dashId}/versions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ version: 5 })
      }),
      { params: Promise.resolve({ id: dashId }) }
    );
    expect(restoreRes.status).toBe(200);

    const dbRowsAfterRestore = await db
      .select()
      .from(dashboardVersions)
      .where(eq(dashboardVersions.dashboardId, dashId));
    expect(dbRowsAfterRestore.length).toBe(5);
  });
});

describe("M1 Feature 5: License Server, Activation, & 402 Gate", () => {
  it("verifies valid, missing, invalid, expired, and revoked keys and gates routes when LICENSE_ENFORCE=true", async () => {
    const adminLogin = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@acme.demo", password: DEMO_PASSWORD })
      })
    );
    const { token: adminToken } = (await adminLogin.json()) as { token: string };

    const engLogin = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "engineer@acme.demo", password: DEMO_PASSWORD })
      })
    );
    const { token: engToken } = (await engLogin.json()) as { token: string };

    // Direct reference server checks
    const healthServer = await fetch(`${licenseUrl}/health`);
    expect(healthServer.status).toBe(200);

    const missingServer = await fetch(`${licenseUrl}/api/licenses/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "" })
    });
    expect(missingServer.status).toBe(400);

    // Enable enforcement
    process.env.LICENSE_ENFORCE = "true";
    resetLicenseCacheForTests();

    // Ungated /api/health works
    const healthRes = await healthGet();
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as {
      ok: boolean;
      license: { enforced: boolean; active: boolean; status: string };
    };
    expect(healthJson.ok).toBe(true);
    expect(healthJson.license.enforced).toBe(true);
    expect(healthJson.license.active).toBe(false);

    // Gated /api/machines returns 402 when unactivated
    const blockedRes = await machinesGet(
      new Request("http://localhost:3000/api/machines", {
        headers: { authorization: `Bearer ${adminToken}` }
      })
    );
    expect(blockedRes.status).toBe(402);

    // Non-admin cannot activate license (403)
    const engActivate = await licensePost(
      new Request("http://localhost:3000/api/license", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${engToken}`
        },
        body: JSON.stringify({ key: "LUTIC-DEV-VALID-0001", serverUrl: licenseUrl })
      })
    );
    expect(engActivate.status).toBe(403);

    // Invalid, expired, revoked keys fail (403) and keep gate closed (402)
    for (const badKey of ["BAD-KEY-1234", "LUTIC-EXP-0000-0001", "LUTIC-REV-0000-0001"]) {
      const badRes = await licensePost(
        new Request("http://localhost:3000/api/license", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${adminToken}`
          },
          body: JSON.stringify({ key: badKey, serverUrl: licenseUrl })
        })
      );
      expect(badRes.status).toBe(403);
      expect(
        (
          await machinesGet(
            new Request("http://localhost:3000/api/machines", {
              headers: { authorization: `Bearer ${adminToken}` }
            })
          )
        ).status
      ).toBe(402);
    }

    // Valid key activates and opens gate
    const okActivate = await licensePost(
      new Request("http://localhost:3000/api/license", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ key: "LUTIC-DEV-VALID-0001", serverUrl: licenseUrl })
      })
    );
    expect(okActivate.status).toBe(200);
    const statusJson = (await (
      await licenseGet(new Request("http://localhost:3000/api/license"))
    ).json()) as { active: boolean; keyHint: string; status: string };
    expect(statusJson.active).toBe(true);
    expect(statusJson.keyHint).toBe("****-0001");

    const allowedRes = await machinesGet(
      new Request("http://localhost:3000/api/machines", {
        headers: { authorization: `Bearer ${adminToken}` }
      })
    );
    expect(allowedRes.status).toBe(200);

    // Revoking key on server and re-verifying closes gate again
    await fetch(`${licenseUrl}/api/licenses/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "LUTIC-DEV-VALID-0001" })
    });
    const reverify = await licenseGet(
      new Request("http://localhost:3000/api/license?verify=true")
    );
    const reverifyJson = (await reverify.json()) as { active: boolean; status: string };
    expect(reverifyJson.active).toBe(false);
    expect(reverifyJson.status).toBe("revoked");

    const blockedAfterRevoke = await machinesGet(
      new Request("http://localhost:3000/api/machines", {
        headers: { authorization: `Bearer ${adminToken}` }
      })
    );
    expect(blockedAfterRevoke.status).toBe(402);

    // Clean up license state & disable enforcement for subsequent tests
    const delRes = await licenseDelete(
      new Request("http://localhost:3000/api/license", {
        method: "DELETE",
        headers: { authorization: `Bearer ${adminToken}` }
      })
    );
    expect(delRes.status).toBe(200);
    delete process.env.LICENSE_ENFORCE;
    resetLicenseCacheForTests();
    resetLicenseStore();
  });
});

describe("M1 Feature 6: Self-Contained Background Runtime", () => {
  let conn: DbConnection;

  beforeAll(async () => {
    conn = await createDbConnection("memory://");
    await seedDatabase(conn);
  });

  afterAll(async () => {
    await conn.close();
  });

  it("skips auto-interval under Vitest and runs deterministic tick across telemetry, alerts, connectors, and queues", async () => {
    expect(shouldSkipAutoRuntime()).toBe(true);

    const db = conn.db;
    // Add an alert rule in OK state that breaches on tick, plus an expired in-flight queue message for DLQ
    await db.insert(alertRules).values({
      id: "ar-test-press",
      tenantId: "tenant-acme",
      plantId: "plant-detroit",
      machineId: "mach-l1-cnc-02",
      name: "Test CNC #2 Vibration",
      metricTag: "vibration",
      operator: "gt",
      threshold: 5.0,
      severity: "high",
      state: "OK",
      notifyTopicId: "topic-plant-alerts",
      workflowId: "wf-spindle-thermal",
      enabled: true
    });

    const past = new Date(Date.now() - 60_000);
    await db.insert(queueMessages).values([
      {
        id: "qmsg-timeout-requeue",
        tenantId: "tenant-acme",
        queueId: "queue-maintenance-dispatch",
        body: { test: "requeue" },
        attributes: {},
        status: "in_flight",
        receiveCount: 1,
        receiptHandle: "rh-1",
        visibleAt: past,
        enqueuedAt: past
      },
      {
        id: "qmsg-timeout-dlq",
        tenantId: "tenant-acme",
        queueId: "queue-maintenance-dispatch",
        body: { test: "dlq" },
        attributes: {},
        status: "in_flight",
        receiveCount: 3,
        receiptHandle: "rh-2",
        visibleAt: past,
        enqueuedAt: past
      }
    ]);

    // Tick 1: breach vibration on mach-l1-cnc-02 + sync connectors + fire triggers + sweep queue
    const summary1 = await runRuntimeTick(db, {
      telemetryOverrides: [{ machineId: "mach-l1-cnc-02", vibration: 9.2 }],
      forceConnectorSync: true,
      forceTriggers: true
    });

    expect(summary1.telemetryUpdated).toBeGreaterThan(0);
    expect(summary1.alertsTriggered).toBeGreaterThanOrEqual(1);
    expect(summary1.connectorsSynced).toBe(16);
    expect(summary1.triggersFired).toBe(2);
    expect(summary1.queueMessagesRequeued).toBe(1);
    expect(summary1.queueMessagesDeadLettered).toBe(1);

    const [ruleAfterBreach] = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.id, "ar-test-press"));
    expect(ruleAfterBreach?.state).toBe("ALARM");

    const breachEvents = await db
      .select()
      .from(alertEvents)
      .where(and(eq(alertEvents.ruleId, "ar-test-press"), eq(alertEvents.status, "ALARM")));
    expect(breachEvents.length).toBe(1);

    const requeuedMsg = await db
      .select()
      .from(queueMessages)
      .where(eq(queueMessages.id, "qmsg-timeout-requeue"));
    expect(requeuedMsg[0]?.status).toBe("ready");

    const dlqMsg = await db
      .select()
      .from(queueMessages)
      .where(eq(queueMessages.id, "qmsg-timeout-dlq"));
    expect(dlqMsg[0]?.status).toBe("dead_letter");
    expect(dlqMsg[0]?.queueId).toBe("queue-maintenance-dlq");

    const syncLogs = await db.select().from(connectorSyncLogs);
    expect(syncLogs.length).toBeGreaterThan(3);

    const wfRuns = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.status, "queued"));
    expect(wfRuns.length).toBeGreaterThanOrEqual(2);

    const notifRows = await db.select().from(notifications);
    expect(notifRows.some((n) => n.title.includes("Test CNC #2 Vibration"))).toBe(true);

    // Tick 2: recover vibration on mach-l1-cnc-02 -> rule OK and event RESOLVED
    const summary2 = await runRuntimeTick(db, {
      telemetryOverrides: [{ machineId: "mach-l1-cnc-02", vibration: 1.5 }]
    });
    expect(summary2.alertsResolved).toBeGreaterThanOrEqual(1);

    const resolvedEvents = await db
      .select()
      .from(alertEvents)
      .where(
        and(eq(alertEvents.ruleId, "ar-test-press"), eq(alertEvents.status, "RESOLVED"))
      );
    expect(resolvedEvents.length).toBe(1);

    const [msAfter] = await db
      .select()
      .from(machineStatus)
      .where(eq(machineStatus.machineId, "mach-l1-cnc-02"));
    expect(msAfter?.vibration).toBe(1.5);
  });
});
