import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  alertEvents,
  alertRules,
  connectorConnections,
  connectorSyncLogs,
  createDbConnection,
  enqueueQueueMessage,
  eq,
  executeQueuedWorkflowRun,
  machineStatus,
  notifications,
  pollQueueMessages,
  publishToTopic,
  readings,
  runRuntimeTick,
  seedDatabase,
  syncConnectorConnection,
  subscriptions,
  testConnectorConnection,
  topics,
  workflowRuns,
  workflows,
  type DbConnection,
  type SessionUser
} from "@kojo/core";
import { executeToolWithPolicy } from "@kojo/agent";
import { defaultMcpRegistry } from "@kojo/connectors";

let conn: DbConnection;
const tenantId = "tenant-acme";
const machineId = "mach-l1-cnc-01";
const connectorId = "conn-unproven-production";

beforeAll(async () => {
  conn = await createDbConnection("memory://");
  await seedDatabase(conn);
  await conn.db.insert(connectorConnections).values({
    id: connectorId,
    tenantId,
    slug: connectorId,
    name: "Unverified adapter",
    transport: "http",
    endpointUrl: "https://example.invalid"
  });
});

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => conn?.close());

it("preserves recorded telemetry and does not claim connector activity in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("KOJO_DEMO_MODE", "true");
  const { db } = conn;
  const readStatus = () => db.select().from(machineStatus).where(eq(machineStatus.machineId, machineId));
  const readReadings = () => db.select({ id: readings.id }).from(readings).where(eq(readings.machineId, machineId));
  const status = await readStatus();
  const previousReadings = await readReadings();

  const summary = await runRuntimeTick(db, {
    telemetryOverrides: [{ machineId, temperature: 999 }],
    forceConnectorSync: true,
    forceTriggers: true
  });

  expect(summary).toMatchObject({ telemetryUpdated: 0, connectorsSynced: 0, triggersFired: 0 });
  expect(await readStatus()).toEqual(status);
  expect(await readReadings()).toEqual(previousReadings);
});

it("reports unsupported external health tests and discovery as failures in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const { db } = conn;

  expect(await testConnectorConnection(db, tenantId, connectorId)).toMatchObject({ ok: false });
  expect(await syncConnectorConnection(db, tenantId, connectorId)).toMatchObject({ ok: false });
  const [connection] = await db.select().from(connectorConnections).where(eq(connectorConnections.id, connectorId));
  expect(connection).toMatchObject({ lastSyncAt: null, discoveredTools: [] });
  const logs = await db.select().from(connectorSyncLogs).where(eq(connectorSyncLogs.connectionId, connectorId));
  expect(logs).toHaveLength(2);
  expect(logs.every((log) => log.status === "failed" && log.recordsSynced === 0)).toBe(true);
});

it("discovers actual registered tools from a local MCP adapter in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const { db } = conn;
  const id = "conn-local-runtime-test";
  await db.insert(connectorConnections).values({
    id, tenantId, slug: id, name: "Local documentation", transport: "in_memory_mcp", endpointUrl: "mcp://docs"
  });

  const discovery = (kind: string) => defaultMcpRegistry.discoverMcpTools(kind);
  expect(await testConnectorConnection(db, tenantId, id, discovery)).toMatchObject({ ok: true });
  const result = await syncConnectorConnection(db, tenantId, id, discovery);
  expect(result.ok).toBe(true);
  expect(result.tools.map((tool) => tool.name)).toContain("search_documents");
  expect(result.tools.map((tool) => tool.name)).not.toContain("get_machine_status");
});

it("evaluates recorded readings and queues scheduled work once in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const { db } = conn;
  const ruleId = "rule-recorded-runtime-test";
  const workflowId = "wf-scheduled-runtime-test";
  const now = new Date();
  await db.insert(readings).values({
    id: "reading-recorded-runtime-test", tenantId, plantId: "plant-detroit", machineId,
    tag: "runtime-test-sensor", ts: now, value: 17, unit: "bar"
  });
  await db.insert(alertRules).values({
    id: ruleId, tenantId, plantId: "plant-detroit", machineId,
    name: "Pressure limit", metricTag: "runtime-test-sensor", operator: "gt", threshold: 10
  });
  await db.insert(workflows).values({
    id: workflowId, tenantId, name: "Scheduled runtime test", createdBy: "user-admin",
    triggerType: "schedule", triggerConfig: { intervalSec: 300 },
    definition: { nodes: [{ id: "start", label: "Start", type: "trigger", config: {} }], edges: [] }
  });
  await db.insert(workflowRuns).values({
    id: "wfr-manual-runtime-test", tenantId, workflowId, triggerSource: "manual", status: "succeeded"
  });

  await Promise.all([runRuntimeTick(db), runRuntimeTick(db)]);

  const [event] = await db.select().from(alertEvents).where(eq(alertEvents.ruleId, ruleId));
  expect(event).toMatchObject({ status: "ALARM", metricValue: 17 });
  const runs = await db.select().from(workflowRuns).where(eq(workflowRuns.workflowId, workflowId));
  expect(runs.filter((run) => run.triggerSource === "schedule")).toHaveLength(1);
});

it("shares the tool quota across independently loaded policy workers", async () => {
  const user: SessionUser = {
    tenantId,
    userId: "user-det-eng",
    role: "engineer",
    plantIds: ["plant-detroit"],
    email: "engineer@acme.demo",
    name: "Marcus Vance"
  };
  const ctx = { user, db: conn.db, requestId: "runtime-limit" };
  const options = { userRateLimit: 1 };
  expect(await executeToolWithPolicy("list_machines", {}, ctx, options)).toMatchObject({ status: "allowed" });

  vi.resetModules();
  const secondWorker = await import("../packages/agent/src/policy");
  expect(await secondWorker.executeToolWithPolicy("list_machines", {}, ctx, options)).toMatchObject({
    status: "denied",
    denialReason: expect.stringContaining("Per-user")
  });
});

it("delivers only one workflow notification when two workers race for a queued run", async () => {
  const { db } = conn;
  const workflowId = "wf-raced-notification";
  const runId = "wfr-raced-notification";
  const title = "Runtime concurrency regression";
  await db.insert(workflows).values({
    id: workflowId,
    tenantId,
    name: title,
    createdBy: "user-admin",
    definition: { nodes: [{ id: "notify", type: "notify", label: "Notify", config: { title } }], edges: [] }
  });
  await db.insert(workflowRuns).values({ id: runId, tenantId, workflowId });

  await Promise.all([executeQueuedWorkflowRun(db, runId), executeQueuedWorkflowRun(db, runId)]);

  const delivered = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.title, title));
  expect(delivered).toHaveLength(1);
});

it("leases a ready queue message to only one racing consumer", async () => {
  const { db } = conn;
  const queueId = "queue-maintenance-dispatch";
  const { messageId } = await enqueueQueueMessage(db, tenantId, queueId, { body: { test: "parallel" } });

  const batches = await Promise.all([
    pollQueueMessages(db, tenantId, queueId, { maxMessages: 20 }),
    pollQueueMessages(db, tenantId, queueId, { maxMessages: 20 })
  ]);
  expect(batches.flat().filter((message) => message.id === messageId)).toHaveLength(1);
});

it("reports an unsupported webhook delivery and skips its simulated success notification", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const { db } = conn;
  const topicId = "topic-webhook-integration-test";
  const subscriptionId = "sub-webhook-integration-test";
  const subject = "External dispatch test";
  await db.insert(topics).values({ id: topicId, tenantId, name: subject });
  await db.insert(subscriptions).values({
    id: subscriptionId, tenantId, topicId, protocol: "webhook", endpoint: "https://example.invalid"
  });

  const result = await publishToTopic(db, tenantId, topicId, { subject });
  expect(result.ok).toBe(false);
  expect(result.deliveries.webhooks).toBe(0);
  expect(result.deliveryFailures).toContainEqual({ subscriptionId, reason: "Webhook delivery is unavailable" });
  const fabricated = await db.select().from(notifications).where(eq(notifications.title, `Webhook Dispatched: ${subject}`));
  expect(fabricated).toHaveLength(0);
});
