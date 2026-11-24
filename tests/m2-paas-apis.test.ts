import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acknowledgeQueueMessage,
  and,
  assets,
  auditLog,
  buildWorkflowFromPrompt,
  connectorConnections,
  connectorTriggers,
  CONNECTOR_CATALOG,
  createDbConnection,
  dashboards,
  dashboardVersions,
  deactivateLicense,
  encryptCredentials,
  enqueueQueueMessage,
  eq,
  executeWorkflow,
  fireConnectorTrigger,
  inventory,
  LicenseError,
  machineStatus,
  notifications,
  parts,
  pollQueueMessages,
  pruneWorkflowVersions,
  publishToTopic,
  purgeQueueMessages,
  queueMessages,
  queues,
  requireLicense,
  resetLicenseCacheForTests,
  runRuntimeTick,
  seedDatabase,
  subscriptions,
  syncConnectorConnection,
  testConnectorConnection,
  topics,
  workOrders,
  workflowRuns,
  workflowVersions,
  workflows,
  type DbConnection,
  type KojoDatabase,
  type SessionUser
} from "@kojo/core";
import { McpToolRegistry, PAAS_CONNECTORS } from "@kojo/connectors";
import { MockLLMProvider, runAgentTurn } from "@kojo/agent";
import { DEMO_PASSWORD } from "@kojo/core";
import { handleLicenseRequest, resetLicenseStore } from "./fixtures/mock-license-server";
import { dynamic as healthDynamic } from "../apps/web/src/app/api/health/route";
import { POST as loginPost } from "../apps/web/src/app/api/auth/login/route";
import { POST as dashboardsPost } from "../apps/web/src/app/api/dashboards/route";
import {
  GET as dashboardVersionsGet,
  POST as dashboardVersionsPost
} from "../apps/web/src/app/api/dashboards/[id]/versions/route";
import { POST as connectorInvokePost } from "../apps/web/src/app/api/connectors/[id]/invoke/route";
import { GET as monitoringMetricsGet } from "../apps/web/src/app/api/monitoring/metrics/route";
import { POST as monitoringTickPost } from "../apps/web/src/app/api/monitoring/tick/route";
import { getWebAdministrativeDb } from "../apps/web/src/lib/db";

let conn: DbConnection;
let db: KojoDatabase;

const detroitEngineer: SessionUser = {
  userId: "user-det-eng",
  tenantId: "tenant-acme",
  role: "engineer",
  plantIds: ["plant-detroit"],
  email: "engineer@acme.demo",
  name: "Marcus Vance"
};

const adminUser: SessionUser = {
  userId: "user-admin",
  tenantId: "tenant-acme",
  role: "admin",
  plantIds: ["plant-detroit", "plant-austin"],
  email: "admin@acme.demo",
  name: "Sarah Chen"
};

describe("Milestone 2 — Core PaaS Services, MCP Tools & Multimodal Agent", () => {
  beforeAll(async () => {
    conn = await createDbConnection("memory://");
    await seedDatabase(conn);
    db = conn.db;
  });

  afterAll(async () => {
    await conn?.close();
  });

  it("builds DAG workflows from prompts, enforces 5-version cap, and executes multi-step DAGs", async () => {
    const draft = buildWorkflowFromPrompt(
      "Monitor mach-l3-filler-01 vibration alert, inspect status, publish notification, and queue triage"
    );
    expect(draft.definition.nodes.length).toBeGreaterThanOrEqual(3);
    expect(draft.definition.edges.length).toBeGreaterThanOrEqual(2);

    const wfId = `wf-m2-${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(workflows).values({
      id: wfId,
      tenantId: "tenant-acme",
      plantId: "plant-detroit",
      name: draft.name,
      description: draft.description,
      triggerType: "manual",
      triggerConfig: {},
      definition: {
        nodes: [
          { id: "n1", type: "trigger", label: "Trigger", config: {} },
          {
            id: "n2",
            type: "mcp",
            label: "Inspect Filler",
            config: { tool: "get_machine_status", args: { machineId: "mach-l3-filler-01" } }
          },
          {
            id: "n3",
            type: "notify",
            label: "Send Ops Alert",
            config: {
              topicId: "topic-plant-alerts",
              subject: "M2 Workflow Notification",
              message: "Automated inspection ran",
              severity: "warning"
            }
          },
          {
            id: "n4",
            type: "queue",
            label: "Queue Maintenance",
            config: { queueId: "queue-maintenance-dispatch", payload: { machineId: "mach-l3-filler-01" } }
          }
        ],
        edges: [
          { id: "e1", source: "n1", target: "n2" },
          { id: "e2", source: "n2", target: "n3" },
          { id: "e3", source: "n3", target: "n4" }
        ]
      },
      currentVersion: 7,
      enabled: true,
      createdBy: detroitEngineer.userId
    });

    for (let v = 1; v <= 7; v++) {
      await db.insert(workflowVersions).values({
        id: `wfv-m2-${wfId}-${v}`,
        tenantId: "tenant-acme",
        workflowId: wfId,
        version: v,
        definition: draft.definition,
        changeSummary: `v${v}`,
        createdBy: detroitEngineer.userId,
        createdAt: new Date(Date.now() + v * 1000)
      });
    }

    await pruneWorkflowVersions(db, wfId, "tenant-acme", 5);

    const remaining = await db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, wfId));
    expect(remaining.length).toBe(5);
    expect(remaining.map((r) => r.version).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7]);

    const run = await executeWorkflow(db, {
      tenantId: "tenant-acme",
      workflowId: wfId,
      triggerSource: "manual",
      triggeredBy: detroitEngineer.userId,
      input: { source: "m2-test" },
      allowedPlantIds: detroitEngineer.plantIds
    });

    expect(run.status).toBe("succeeded");
    expect(Array.isArray(run.stepTraces)).toBe(true);
    expect(run.stepTraces.length).toBe(4);
    expect(run.stepTraces.every((t) => t.status === "succeeded")).toBe(true);
  });

  it("tests, syncs, and triggers Kojo Connector Hub connections with encrypted config", async () => {
    expect(CONNECTOR_CATALOG.length).toBeGreaterThanOrEqual(5);

    const connId = `cc-m2-${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(connectorConnections).values({
      id: connId,
      tenantId: "tenant-acme",
      slug: `m2-custom-cmms-${connId}`,
      name: "M2 Custom CMMS",
      category: "mcp",
      transport: "simulated",
      endpointUrl: "https://cmms.example.local/api",
      credentialsEncrypted: encryptCredentials({ apiKey: "secret-m2-key" }),
      config: { env: "test" },
      discoveredTools: [],
      status: "connected"
    });

    const health = await testConnectorConnection(db, "tenant-acme", connId);
    expect(health.ok).toBe(true);

    const synced = await syncConnectorConnection(db, "tenant-acme", connId);
    expect(synced.ok).toBe(true);
    expect(synced.tools.length).toBeGreaterThan(0);

    const wfId = `wf-trig-${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(workflows).values({
      id: wfId,
      tenantId: "tenant-acme",
      plantId: "plant-detroit",
      name: "Connector Trigger Target",
      description: "",
      triggerType: "connector",
      triggerConfig: {},
      definition: {
        nodes: [{ id: "n1", type: "trigger", label: "Webhook Trigger", config: {} }],
        edges: []
      },
      currentVersion: 1,
      enabled: true,
      createdBy: adminUser.userId
    });

    const trigId = `ctr-m2-${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(connectorTriggers).values({
      id: trigId,
      tenantId: "tenant-acme",
      connectionId: connId,
      workflowId: wfId,
      name: "On Work Order Created",
      eventType: "work_order.created",
      filterConfig: {},
      enabled: true
    });

    const fired = await fireConnectorTrigger(db, "tenant-acme", trigId, { wo: "WO-991" });
    expect(fired.ok).toBe(true);
    expect(fired.workflowRunId).toBeTruthy();

    const runs = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, fired.workflowRunId!));
    expect(runs[0]?.triggerSource).toBe("connector");
  });

  it("fans out Kojo topics and manages Kojo queue visibility timeouts, DLQ routing, ack, and purge", async () => {
    const topicId = `topic-m2-${crypto.randomUUID().slice(0, 8)}`;
    const dlqId = `queue-dlq-${crypto.randomUUID().slice(0, 8)}`;
    const qId = `queue-m2-${crypto.randomUUID().slice(0, 8)}`;

    await db.insert(topics).values({
      id: topicId,
      tenantId: "tenant-acme",
      name: "M2 Fault Fanout",
      description: "Test topic"
    });

    await db.insert(queues).values([
      {
        id: dlqId,
        tenantId: "tenant-acme",
        name: "M2 DLQ",
        visibilityTimeoutSec: 30,
        maxReceiveCount: 3
      },
      {
        id: qId,
        tenantId: "tenant-acme",
        name: "M2 Main Queue",
        visibilityTimeoutSec: 1,
        maxReceiveCount: 1,
        deadLetterQueueId: dlqId
      }
    ]);

    await db.insert(subscriptions).values([
      {
        id: `sub-inapp-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: "tenant-acme",
        topicId,
        protocol: "in_app",
        endpoint: detroitEngineer.userId,
        filterPolicy: {},
        enabled: true
      },
      {
        id: `sub-q-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: "tenant-acme",
        topicId,
        protocol: "queue",
        endpoint: qId,
        filterPolicy: {},
        enabled: true
      }
    ]);

    const pub = await publishToTopic(db, "tenant-acme", topicId, {
      subject: "Sensor Drift Detected",
      message: "Check filler bearing",
      severity: "high"
    });
    expect(pub.deliveries.inApp).toBe(1);
    expect(pub.deliveries.queues).toBe(1);

    // Enqueue a second message explicitly for ack + purge verification
    const extra = await enqueueQueueMessage(db, "tenant-acme", qId, {
      payload: { task: "inspect-valve" }
    });
    expect(extra.messageId).toBeTruthy();

    const leased = await pollQueueMessages(db, "tenant-acme", qId, {
      maxMessages: 2,
      visibilityTimeoutSec: 0
    });
    expect(leased.length).toBe(2);

    // Ack the second message cleanly
    const ackRes = await acknowledgeQueueMessage(db, "tenant-acme", qId, {
      receiptHandle: leased[1]!.receiptHandle!
    });
    expect(ackRes.ok).toBe(true);

    // Next poll sweeps the expired first message into DLQ because maxReceiveCount === 1
    await pollQueueMessages(db, "tenant-acme", qId, { maxMessages: 2 });
    const dlqMsgs = await db
      .select()
      .from(queueMessages)
      .where(eq(queueMessages.queueId, dlqId));
    expect(dlqMsgs.length).toBe(1);
    expect(dlqMsgs[0]?.status).toBe("dead_letter");

    const purged = await purgeQueueMessages(db, "tenant-acme", dlqId);
    expect(purged.purgedCount).toBe(1);
  });

  it("exposes paas.* MCP tools and handles multimodal attachments in runAgentTurn", async () => {
    const registry = new McpToolRegistry(PAAS_CONNECTORS);
    const allNames = registry.listToolDefinitions().map((t) => t.name);
    expect(allNames).toContain("paas.list_workflows");
    expect(allNames).toContain("paas.trigger_workflow");
    expect(allNames).toContain("paas.list_alerts");
    expect(allNames).toContain("paas.acknowledge_alert");
    expect(allNames).toContain("paas.publish_notification");
    expect(allNames).toContain("paas.inspect_queues");

    const wfRes = await registry.callToolOverMcp(
      "paas.list_workflows",
      { limit: 10 },
      {
        db,
        user: adminUser,
        requestId: "req-m2-test"
      }
    );
    expect(Array.isArray((wfRes as { workflows: unknown[] }).workflows)).toBe(true);

    const turn = await runAgentTurn({
      db,
      llmProvider: new MockLLMProvider(),
      registry,
      user: detroitEngineer,
      message: "Analyze this attached diagnostic log and list active workflows",
      attachments: [
        {
          attachmentId: "att-m2-1",
          name: "vibration-notes.txt",
          mimeType: "text/plain",
          kind: "text",
          size: 48,
          extractedText: "Filler L3 bearing peak RMS reached 7.8 mm/s on axis B."
        }
      ]
    });

    expect(turn.answer.length).toBeGreaterThan(20);
    expect(turn.usage.promptTokens).toBeGreaterThan(0);

    const noteCount = (
      await db
        .select()
        .from(notifications)
        .where(eq(notifications.tenantId, "tenant-acme"))
    ).length;
    expect(noteCount).toBeGreaterThanOrEqual(1);
  });

  it("enforces plant scoping on workflow work_orders/parts, records skipped branches, and updates >20 machines on tick", async () => {
    const austinMachines = await db
      .select()
      .from(assets)
      .where(and(eq(assets.tenantId, "tenant-acme"), eq(assets.plantId, "plant-austin")));
    const austinMach = austinMachines.find((m) => m.type === "machine") ?? austinMachines[0]!;
    expect(austinMach).toBeTruthy();

    // Runtime tick must update ALL >20 seeded machines and apply override to Austin machine
    const tickRes = await runRuntimeTick(db, {
      telemetryOverrides: [{ machineId: austinMach.id, vibration: 8.4 }]
    });
    expect(tickRes.telemetryUpdated).toBeGreaterThan(20);
    const [austinStatus] = await db
      .select()
      .from(machineStatus)
      .where(eq(machineStatus.machineId, austinMach.id));
    expect(austinStatus?.vibration).toBe(8.4);

    // Seed Austin-only part + inventory to verify plant scoping inside find_part_for_fault
    const austinPartId = `part-austin-${crypto.randomUUID().slice(0, 6)}`;
    await db.insert(parts).values({
      id: austinPartId,
      tenantId: "tenant-acme",
      partNo: "AUS-ONLY-999",
      description: "Austin Exclusive Valve",
      unitCost: 100
    });
    await db.insert(inventory).values({
      id: `inv-${austinPartId}`,
      tenantId: "tenant-acme",
      partId: austinPartId,
      plantId: "plant-austin",
      onHand: 4,
      reserved: 0,
      minLevel: 1,
      location: "Austin-Bin-A1"
    });

    // Workflow targeting Austin machine + parts + false condition skip
    const wfScopedId = `wf-scope-${crypto.randomUUID().slice(0, 6)}`;
    await db.insert(workflows).values({
      id: wfScopedId,
      tenantId: "tenant-acme",
      name: "Scoped Work Order Test",
      description: "Verifies plant scoping",
      triggerType: "manual",
      triggerConfig: {},
      definition: {
        nodes: [
          { id: "n1", type: "mcp", label: "Lookup Parts", config: { tool: "find_part_for_fault" } },
          {
            id: "n2",
            type: "work_order",
            label: "Create Austin WO",
            config: { machineId: austinMach.id, description: "Should be blocked for Detroit" }
          }
        ],
        edges: [{ id: "e1", source: "n1", target: "n2" }]
      },
      currentVersion: 1,
      enabled: true,
      createdBy: detroitEngineer.userId
    });

    const beforeWoCount = (
      await db.select().from(workOrders).where(eq(workOrders.machineId, austinMach.id))
    ).length;

    const scopedRun = await executeWorkflow(db, {
      tenantId: "tenant-acme",
      workflowId: wfScopedId,
      triggeredBy: detroitEngineer.userId,
      allowedPlantIds: ["plant-detroit"]
    });
    expect(scopedRun.status).toBe("succeeded");
    const partStep = (scopedRun.stepTraces as Array<{ nodeId: string; output?: { parts?: Array<{ partNo: string }> } }>).find(
      (s) => s.nodeId === "n1"
    );
    expect(partStep?.output?.parts?.some((p) => p.partNo === "AUS-ONLY-999")).toBe(false);
    const woStep = (scopedRun.stepTraces as Array<{ nodeId: string; output?: { workOrderCreated?: boolean } }>).find(
      (s) => s.nodeId === "n2"
    );
    expect(woStep?.output?.workOrderCreated).toBe(false);
    const afterWoCount = (
      await db.select().from(workOrders).where(eq(workOrders.machineId, austinMach.id))
    ).length;
    expect(afterWoCount).toBe(beforeWoCount);

    // Condition false skips downstream nodes explicitly
    const wfCondId = `wf-cond-${crypto.randomUUID().slice(0, 6)}`;
    await db.insert(workflows).values({
      id: wfCondId,
      tenantId: "tenant-acme",
      name: "Condition Skip Test",
      description: "Verifies skipped trace status",
      triggerType: "manual",
      triggerConfig: {},
      definition: {
        nodes: [
          {
            id: "c1",
            type: "condition",
            label: "High Temp",
            config: { metricTag: "temperature", operator: "gt", threshold: 500 }
          },
          { id: "n2", type: "notify", label: "Send Alert", config: { title: "Skipped" } }
        ],
        edges: [{ id: "e1", source: "c1", target: "n2" }]
      },
      currentVersion: 1,
      enabled: true,
      createdBy: detroitEngineer.userId
    });
    const condRun = await executeWorkflow(db, {
      tenantId: "tenant-acme",
      workflowId: wfCondId,
      input: { temperature: 45 },
      triggeredBy: detroitEngineer.userId
    });
    const skippedTrace = (condRun.stepTraces as Array<{ nodeId: string; status: string }>).find(
      (s) => s.nodeId === "n2"
    );
    expect(skippedTrace?.status).toBe("skipped");
  });

  it("enforces dynamic /api/health, license deactivation lock, and API route plant/ownership security", async () => {
    expect(healthDynamic).toBe("force-dynamic");

    // requireLicense must NOT re-activate KOJO_LICENSE_KEY after explicit deactivation
    process.env.DATABASE_URL = "memory://";
    const webDb = await getWebAdministrativeDb();
    resetLicenseStore();
    resetLicenseCacheForTests();
    const prevEnforce = process.env.LICENSE_ENFORCE;
    const prevKey = process.env.KOJO_LICENSE_KEY;
    const prevFetch = globalThis.fetch;
    process.env.LICENSE_ENFORCE = "true";
    process.env.KOJO_LICENSE_KEY = "KOJO-PRO-VALID-2026";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      if (urlStr.includes(":4100")) {
        return handleLicenseRequest(new Request(urlStr, init));
      }
      return prevFetch(input, init);
    }) as typeof fetch;

    try {
      await deactivateLicense(webDb);
      await expect(requireLicense(webDb)).rejects.toThrow(LicenseError);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevEnforce === undefined) delete process.env.LICENSE_ENFORCE;
      else process.env.LICENSE_ENFORCE = prevEnforce;
      if (prevKey === undefined) delete process.env.KOJO_LICENSE_KEY;
      else process.env.KOJO_LICENSE_KEY = prevKey;
      resetLicenseCacheForTests();
    }

    const loginToken = async (email: string) => {
      const res = await loginPost(
        new Request("http://localhost:3000/api/auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            host: "localhost:3000"
          },
          body: JSON.stringify({ email, password: DEMO_PASSWORD })
        })
      );
      return ((await res.json()) as { token: string }).token;
    };

    const [adminToken, analystToken, detEngToken] = await Promise.all([
      loginToken("admin@acme.demo"),
      loginToken("analyst@acme.demo"),
      loginToken("engineer@acme.demo")
    ]);

    // Dashboard template cloning & version ownership/share checks
    const privDashId = `dash-priv-${crypto.randomUUID().slice(0, 6)}`;
    await webDb.insert(dashboards).values({
      id: privDashId,
      tenantId: "tenant-acme",
      ownerId: "user-admin",
      title: "Admin Private Executive Board",
      description: "Restricted",
      plantScope: ["plant-austin"],
      spec: {
        id: privDashId,
        title: "Admin Private Executive Board",
        description: "Restricted",
        plantScope: ["plant-austin"],
        filters: { range: "7d" },
        widgets: [{ id: "w1", type: "kpi", title: "OEE", metric: "oee", range: "7d" }],
        layout: [{ i: "w1", x: 0, y: 0, w: 4, h: 3 }],
        version: 1
      },
      currentVersion: 1,
      isTemplate: false
    });
    await webDb.insert(dashboardVersions).values({
      id: `dv-${privDashId}-v1`,
      tenantId: "tenant-acme",
      dashboardId: privDashId,
      version: 1,
      spec: {
        id: privDashId,
        title: "Admin Private Executive Board",
        description: "Restricted",
        plantScope: ["plant-austin"],
        filters: { range: "7d" },
        widgets: [{ id: "w1", type: "kpi", title: "OEE", metric: "oee", range: "7d" }],
        layout: [{ i: "w1", x: 0, y: 0, w: 4, h: 3 }],
        version: 1
      },
      createdBy: "user-admin",
      changeSummary: "Initial"
    });

    const cloneDenied = await dashboardsPost(
      new Request("http://localhost:3000/api/dashboards", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${analystToken}`
        },
        body: JSON.stringify({ title: "Stolen", fromTemplateId: privDashId })
      })
    );
    expect(cloneDenied.status).toBe(403);

    const verReadDenied = await dashboardVersionsGet(
      new Request(`http://localhost:3000/api/dashboards/${privDashId}/versions`, {
        headers: { authorization: `Bearer ${detEngToken}` }
      }),
      { params: Promise.resolve({ id: privDashId }) }
    );
    expect(verReadDenied.status).toBe(403);

    const verRestoreDenied = await dashboardVersionsPost(
      new Request(`http://localhost:3000/api/dashboards/${privDashId}/versions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${analystToken}`
        },
        body: JSON.stringify({ version: 1 })
      }),
      { params: Promise.resolve({ id: privDashId }) }
    );
    expect(verRestoreDenied.status).toBe(403);

    // Connector invoke plant scope + write confirmation + auditLog
    const austinMachines = await webDb
      .select()
      .from(assets)
      .where(and(eq(assets.tenantId, "tenant-acme"), eq(assets.plantId, "plant-austin")));
    const austinMachId = austinMachines[0]!.id;

    // Monitoring metrics returns full authorized plant fleet when unfiltered, single machine when filtered
    const fullMetricsRes = await monitoringMetricsGet(
      new Request("http://localhost:3000/api/monitoring/metrics", {
        headers: { authorization: `Bearer ${adminToken}` }
      })
    );
    expect(fullMetricsRes.status).toBe(200);
    const fullMetrics = (await fullMetricsRes.json()) as {
      machineId: string | null;
      machines: Array<{ id: string; plantId: string }>;
      series: unknown[];
    };
    expect(fullMetrics.machines.length).toBeGreaterThan(1);
    expect(fullMetrics.machineId).toBe(fullMetrics.machines[0]?.id);
    const sortedIds = [...fullMetrics.machines.map((m) => m.id)].sort((a, b) =>
      a.localeCompare(b)
    );
    expect(fullMetrics.machines.map((m) => m.id)).toEqual(sortedIds);

    const secondMachineId = fullMetrics.machines[1]!.id;
    const singleMetricsRes = await monitoringMetricsGet(
      new Request(
        `http://localhost:3000/api/monitoring/metrics?machineId=${encodeURIComponent(secondMachineId)}`,
        { headers: { authorization: `Bearer ${adminToken}` } }
      )
    );
    expect(singleMetricsRes.status).toBe(200);
    const singleMetrics = (await singleMetricsRes.json()) as {
      machineId: string | null;
      machines: Array<{ id: string }>;
    };
    expect(singleMetrics.machineId).toBe(secondMachineId);
    expect(singleMetrics.machines.map((m) => m.id)).toEqual([secondMachineId]);

    const austinMachineAsset =
      austinMachines.find((m) => m.type === "machine") ?? austinMachines[0]!;
    const metricsForbidden = await monitoringMetricsGet(
      new Request(
        `http://localhost:3000/api/monitoring/metrics?machineId=${encodeURIComponent(austinMachineAsset.id)}`,
        { headers: { authorization: `Bearer ${detEngToken}` } }
      )
    );
    expect(metricsForbidden.status).toBe(403);

    // Monitoring tick rejects cross-plant telemetryOverride for Detroit engineer
    const tickForbidden = await monitoringTickPost(
      new Request("http://localhost:3000/api/monitoring/tick", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${detEngToken}`
        },
        body: JSON.stringify({
          telemetryOverrides: [{ machineId: austinMachId, vibration: 9.9 }]
        })
      })
    );
    expect(tickForbidden.status).toBe(403);

    const writeBlocked = await connectorInvokePost(
      new Request("http://localhost:3000/api/connectors/conn-hub-cmms/invoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          toolName: "draft_work_order",
          args: {
            machineId: "mach-l1-cnc-01",
            type: "corrective",
            priority: "high",
            description: "Check spindle fan"
          }
        })
      }),
      { params: Promise.resolve({ id: "conn-hub-cmms" }) }
    );
    expect(writeBlocked.status).toBe(409);

    const readOk = await connectorInvokePost(
      new Request("http://localhost:3000/api/connectors/conn-hub-cmms/invoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          toolName: "get_work_orders",
          args: { machineId: "mach-l1-cnc-01", limit: 3 }
        })
      }),
      { params: Promise.resolve({ id: "conn-hub-cmms" }) }
    );
    expect(readOk.status).toBe(200);
    const invAudits = await webDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "connector_invoke"));
    expect(invAudits.some((a) => a.toolName === "get_work_orders" && a.status === "allowed")).toBe(true);
  });
});
