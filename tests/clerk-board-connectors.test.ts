import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  boardIssues,
  CONNECTOR_CATALOG,
  createDbConnection,
  DEMO_PASSWORD,
  ensureSchema,
  eq,
  plants,
  resetGlobalDbForTests,
  seedDatabase,
  tenants,
  userPlants,
  users,
  type DbConnection
} from "@lutic/core";
import { checkScannerHealth } from "@lutic/agent";
import { resolveClerkSessionUser } from "../apps/web/src/lib/clerk";
import { POST as loginPost } from "../apps/web/src/app/api/auth/login/route";
import { GET as boardGet, POST as boardPost } from "../apps/web/src/app/api/board/route";
import { PATCH as boardPatch, DELETE as boardDelete } from "../apps/web/src/app/api/board/[id]/route";
import { POST as connectorInvokePost } from "../apps/web/src/app/api/connectors/[id]/invoke/route";
import { GET as connectorsGet, POST as connectorsPost } from "../apps/web/src/app/api/connectors/route";

describe("Clerk Free-Tier Auth, Plan Provisioning, White-Label, Enterprise/OT Connectors & Board", () => {
  let webConn: DbConnection;

  beforeAll(async () => {
    resetGlobalDbForTests();
    vi.stubEnv("LICENSE_ENFORCE", "false");
    vi.stubEnv("LUTIC_DEMO_MODE", "true");
    webConn = await createDbConnection("memory://");
    await seedDatabase(webConn);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("LICENSE_ENFORCE", "false");
    vi.stubEnv("LUTIC_DEMO_MODE", "true");
  });

  afterAll(async () => {
    await webConn?.close();
    resetGlobalDbForTests();
  });

  it("auto-provisions personal Free workspace idempotently and enforces Enterprise invite-only mode", async () => {
    const conn = await createDbConnection("memory://");
    try {
      await ensureSchema(conn);

      // 1. Free / Individual plan: first Clerk verified login auto-provisions workspace + plant + board
      vi.stubEnv("LUTIC_DEPLOYMENT_PLAN", "free");
      const first = await resolveClerkSessionUser(
        {
          externalAuthId: "user_clerk_free_01",
          email: "maya.ops@example.com",
          emailVerified: true,
          name: "Maya Patel"
        },
        { db: conn.db }
      );
      expect(first).not.toBeNull();
      expect(first?.role).toBe("admin");
      expect(first?.plantIds).toHaveLength(1);
      expect(first?.email).toBe("maya.ops@example.com");

      const second = await resolveClerkSessionUser(
        {
          externalAuthId: "user_clerk_free_01",
          email: "maya.ops@example.com",
          emailVerified: true,
          name: "Maya Patel"
        },
        { db: conn.db }
      );
      expect(second?.userId).toBe(first?.userId);
      expect(second?.tenantId).toBe(first?.tenantId);

      const tenantRows = await conn.db.select().from(tenants);
      expect(tenantRows).toHaveLength(1);
      expect(tenantRows[0]?.plan).toBe("free");

      const starterBoard = await conn.db
        .select()
        .from(boardIssues)
        .where(eq(boardIssues.tenantId, first!.tenantId));
      expect(starterBoard.length).toBeGreaterThanOrEqual(3);

      // 2. Enterprise plan: unknown user is blocked (returns null, zero new tenant created)
      vi.stubEnv("LUTIC_DEPLOYMENT_PLAN", "enterprise");
      const uninvited = await resolveClerkSessionUser(
        {
          externalAuthId: "user_clerk_stranger",
          email: "stranger@unknown-corp.com",
          emailVerified: true,
          name: "Uninvited User"
        },
        { db: conn.db }
      );
      expect(uninvited).toBeNull();
      expect(await conn.db.select().from(tenants)).toHaveLength(1);

      // 3. Security: unverified email must NEVER link to an invited enterprise user row
      await conn.db.insert(tenants).values({
        id: "tenant-ent",
        name: "Acme Enterprise",
        slug: "acme-ent",
        plan: "enterprise"
      });
      await conn.db.insert(plants).values({
        id: "plant-ent-1",
        tenantId: "tenant-ent",
        name: "Chicago Plant",
        code: "CHI-01",
        timezone: "UTC",
        location: ""
      });
      await conn.db.insert(users).values({
        id: "usr-ent-invited",
        tenantId: "tenant-ent",
        email: "invited.lead@acme-ent.com",
        name: "Invited Lead",
        passwordHash: "invited-placeholder",
        role: "manager",
        active: true
      });
      await conn.db.insert(userPlants).values({
        tenantId: "tenant-ent",
        userId: "usr-ent-invited",
        plantId: "plant-ent-1"
      });

      const unverifiedAttack = await resolveClerkSessionUser(
        {
          externalAuthId: "user_clerk_spoof",
          email: "invited.lead@acme-ent.com",
          emailVerified: false,
          name: "Spoof"
        },
        { db: conn.db }
      );
      expect(unverifiedAttack).toBeNull();

      // 4. Verified invited enterprise user links external_auth_id and keeps exact DB role & plant scope
      const verifiedInvited = await resolveClerkSessionUser(
        {
          externalAuthId: "user_clerk_ent_lead",
          email: "invited.lead@acme-ent.com",
          emailVerified: true,
          name: "Invited Lead"
        },
        { db: conn.db }
      );
      expect(verifiedInvited).toMatchObject({
        userId: "usr-ent-invited",
        tenantId: "tenant-ent",
        role: "manager",
        plantIds: ["plant-ent-1"]
      });
    } finally {
      await conn.close();
    }
  });

  it("white-labels security scanner diagnostics, connector catalog, and user-facing UI surfaces", async () => {
    vi.stubEnv("CLAMAV_HOST", "");
    const unconfiguredScan = await checkScannerHealth();
    expect(unconfiguredScan.detail ?? "").not.toMatch(/clamav|clamd/i);

    const catalogText = JSON.stringify(CONNECTOR_CATALOG);
    expect(catalogText).not.toMatch(/\b(clamav|litellm|metorial|openconnectors|open-connector|utcp|pglite)\b/i);

    const uiFiles = [
      "apps/web/src/app/page.tsx",
      "apps/web/src/app/login/page.tsx",
      "apps/web/src/components/admin-console.tsx",
      "apps/web/src/components/connectors-console.tsx"
    ];
    const bannedUiTerms = /\b(ClamAV|CLAMAV_HOST|LiteLLM|Metorial|OpenConnectors|PGlite|UTCP)\b/;
    for (const rel of uiFiles) {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
      expect(src).not.toMatch(bannedUiTerms);
    }
  });

  it("includes SAP modules, AWS services, ServiceNow, MQTT, OPC-UA, and Modbus connectors and invokes them in demo mode", async () => {
    const requiredSlugs = [
      "sap-pm",
      "sap-mm",
      "sap-pp",
      "sap-qm",
      "aws-iot",
      "aws-s3",
      "aws-cloudwatch",
      "servicenow",
      "mqtt-broker",
      "opc-ua",
      "modbus-tcp"
    ];
    for (const slug of requiredSlugs) {
      expect(CONNECTOR_CATALOG.some((entry) => entry.slug === slug)).toBe(true);
    }

    expect(CONNECTOR_CATALOG.length).toBeGreaterThan(2000);
    const catalogSlugs = CONNECTOR_CATALOG.map((entry) => entry.slug);
    expect(new Set(catalogSlugs).size).toBe(catalogSlugs.length);
    expect(
      CONNECTOR_CATALOG.some(
        (entry) =>
          entry.transport === "in_memory_mcp" ||
          entry.slug.startsWith("lutic-") ||
          /\blutic\b/i.test(entry.name)
      )
    ).toBe(false);

    for (const popular of ["slack", "github", "jira", "linear", "stripe", "digicert", "tabapi"]) {
      const found = CONNECTOR_CATALOG.find((entry) => entry.slug === popular);
      expect(found, `Missing ${popular} in CONNECTOR_CATALOG`).toBeDefined();
      expect(found!.defaultTools.length).toBeGreaterThan(0);
    }

    const loginRes = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@acme.demo", password: DEMO_PASSWORD })
      })
    );
    expect(loginRes.status).toBe(200);
    const { token } = (await loginRes.json()) as { token: string };

    const listRes = await connectorsGet(
      new Request("http://localhost:3000/api/connectors", {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      connectors: Array<{ id: string; slug: string }>;
      catalog: Array<{ slug: string }>;
    };
    expect(listBody.connectors.some((c) => c.slug === "sap-pm")).toBe(true);
    expect(listBody.connectors.some((c) => c.slug === "servicenow")).toBe(true);
    expect(listBody.connectors.some((c) => c.slug === "opc-ua")).toBe(true);
    expect(listBody.connectors.some((c) => c.slug === "modbus-tcp")).toBe(true);
    expect(
      listBody.connectors.some((c) =>
        [
          "cmms",
          "historian",
          "mes",
          "parts-erp",
          "docs",
          "ops-webhook",
          "lutic-cloud",
          "lutic-bridge",
          "lutic-api"
        ].includes(c.slug)
      )
    ).toBe(false);

    // Invoke SAP PM and OPC-UA simulated tools via Connector Playground endpoint
    const sapRes = await connectorInvokePost(
      new Request("http://localhost:3000/api/connectors/conn-hub-sap-pm/invoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ toolName: "sap_pm_list_notifications", args: { plant: "DET-01" } })
      }),
      { params: Promise.resolve({ id: "conn-hub-sap-pm" }) }
    );
    expect(sapRes.status).toBe(200);
    const sapBody = (await sapRes.json()) as { result: { system?: string } };
    expect(sapBody.result.system).toBe("SAP S/4HANA");

    // Register a new connector using white-labeled Lutic slug
    const createRes = await connectorsPost(
      new Request("http://localhost:3000/api/connectors", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: "Enterprise SAP QM QA",
          kind: "sap-qm",
          endpointUrl: "sap://s4hana.example/qm"
        })
      })
    );
    expect(createRes.status).toBe(201);

    const jiraCreateRes = await connectorsPost(
      new Request("http://localhost:3000/api/connectors", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: "Jira Cloud Ops",
          kind: "jira"
        })
      })
    );
    expect(jiraCreateRes.status).toBe(201);
    const jiraCreated = (await jiraCreateRes.json()) as {
      id: string;
      connector: { discoveredTools: Array<{ name: string }> };
    };
    expect(jiraCreated.connector.discoveredTools.length).toBeGreaterThan(0);

    const jiraInvoke = await connectorInvokePost(
      new Request(`http://localhost:3000/api/connectors/${jiraCreated.id}/invoke`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          toolName: jiraCreated.connector.discoveredTools[0]!.name,
          args: {}
        })
      }),
      { params: Promise.resolve({ id: jiraCreated.id }) }
    );
    expect(jiraInvoke.status).toBe(200);
  });

  it("supports Jira/Linear-style Board CRUD with strict cross-tenant isolation", async () => {
    const loginAcme = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@acme.demo", password: DEMO_PASSWORD })
      })
    );
    const { token: acmeToken } = (await loginAcme.json()) as { token: string };

    const loginBeta = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@beta.demo", password: DEMO_PASSWORD })
      })
    );
    expect(loginBeta.status).toBe(200);
    const { token: betaToken } = (await loginBeta.json()) as { token: string };

    const initialGet = await boardGet(
      new Request("http://localhost:3000/api/board", {
        headers: { authorization: `Bearer ${acmeToken}` }
      })
    );
    expect(initialGet.status).toBe(200);
    const initialBody = (await initialGet.json()) as {
      issues: Array<{ id: string; identifier: string }>;
    };
    expect(initialBody.issues.some((i) => i.identifier === "LUT-101")).toBe(true);

    const createRes = await boardPost(
      new Request("http://localhost:3000/api/board", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${acmeToken}`
        },
        body: JSON.stringify({
          title: "Automate SAP MM reorder trigger on seal wear",
          priority: "high",
          category: "automation",
          status: "todo",
          sourceRef: "SAP MM #100999"
        })
      })
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      issue: { id: string; identifier: string; status: string };
    };
    expect(created.issue.identifier).toMatch(/^LUT-\d+$/);

    const patchRes = await boardPatch(
      new Request(`http://localhost:3000/api/board/${created.issue.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${acmeToken}`
        },
        body: JSON.stringify({ status: "in_progress", priority: "urgent" })
      }),
      { params: Promise.resolve({ id: created.issue.id }) }
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { issue: { status: string; priority: string } };
    expect(patched.issue.status).toBe("in_progress");
    expect(patched.issue.priority).toBe("urgent");

    // Cross-tenant isolation: Beta tenant cannot view or mutate Acme board issue
    const betaGet = await boardGet(
      new Request("http://localhost:3000/api/board", {
        headers: { authorization: `Bearer ${betaToken}` }
      })
    );
    expect(betaGet.status).toBe(200);
    const betaBody = (await betaGet.json()) as { issues: Array<{ id: string }> };
    expect(betaBody.issues.some((i) => i.id === created.issue.id)).toBe(false);

    const betaPatch = await boardPatch(
      new Request(`http://localhost:3000/api/board/${created.issue.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${betaToken}`
        },
        body: JSON.stringify({ status: "done" })
      }),
      { params: Promise.resolve({ id: created.issue.id }) }
    );
    expect(betaPatch.status).toBe(404);

    const delRes = await boardDelete(
      new Request(`http://localhost:3000/api/board/${created.issue.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${acmeToken}` }
      }),
      { params: Promise.resolve({ id: created.issue.id }) }
    );
    expect(delRes.status).toBe(200);
  });
});
