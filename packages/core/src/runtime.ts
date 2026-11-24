import crypto from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { LuticDatabase } from "./db/client";
import {
  alertEvents,
  alertRules,
  assets,
  connectorConnections,
  connectorSyncLogs,
  connectorTriggers,
  machineStatus,
  notifications,
  queueMessages,
  queues,
  readings,
  subscriptions,
  workflowRuns,
  workflows
} from "./db/schema";
import { logger } from "./logger";
import { sweepQueueVisibilityTimeouts } from "./messaging";
import { pruneExpiredRateLimits } from "./rate-limit";

export interface TelemetryOverride {
  machineId: string;
  vibration?: number;
  temperature?: number;
  pressure?: number;
  currentSpeed?: number;
  status?: "running" | "idle" | "fault" | "offline";
}

export interface RuntimeTickOptions {
  telemetryOverrides?: TelemetryOverride[];
  forceConnectorSync?: boolean;
  forceTriggers?: boolean;
  scope?: { tenantId: string; plantIds: string[]; machineId?: string };
  executeWorkflowRun?: RuntimeHooks["executeWorkflowRun"];
}

export interface RuntimeTickSummary {
  tickAt: string;
  telemetryUpdated: number;
  rulesEvaluated: number;
  alertsTriggered: number;
  alertsResolved: number;
  connectorsSynced: number;
  triggersFired: number;
  queueMessagesRequeued: number;
  queueMessagesDeadLettered: number;
  scheduledWorkflowsQueued: number;
  skipped?: "busy";
}

export interface RuntimeHooks {
  executeWorkflowRun?: (db: LuticDatabase, runId: string) => Promise<void>;
}

export interface RuntimeHealthSnapshot {
  autoEnabled: boolean;
  intervalMs: number;
  startedAt: string | null;
  lastTickAt: string | null;
  lastTickDurationMs: number | null;
  lastTickError: string | null;
  tickCount: number;
  lastTickSummary: RuntimeTickSummary | null;
}

const globalForRuntime = globalThis as unknown as {
  __luticRuntimeState?: {
    timer?: ReturnType<typeof setInterval>;
    hooks?: RuntimeHooks;
    startedAt?: string;
    lastTickAt?: string;
    lastTickDurationMs?: number;
    lastTickError?: string | null;
    tickCount?: number;
    lastTickSummary?: RuntimeTickSummary;
  };
};

function getRuntimeState() {
  if (!globalForRuntime.__luticRuntimeState) {
    globalForRuntime.__luticRuntimeState = {};
  }
  return globalForRuntime.__luticRuntimeState;
}

export function getRuntimeHealthSnapshot(): RuntimeHealthSnapshot {
  const state = getRuntimeState();
  const rawInterval = Number(process.env.RUNTIME_TICK_INTERVAL_MS ?? 15000);
  return {
    autoEnabled: !shouldSkipAutoRuntime(),
    intervalMs: Number.isFinite(rawInterval) && rawInterval >= 1000 ? rawInterval : 15000,
    startedAt: state.startedAt ?? null,
    lastTickAt: state.lastTickAt ?? null,
    lastTickDurationMs: state.lastTickDurationMs ?? null,
    lastTickError: state.lastTickError ?? null,
    tickCount: state.tickCount ?? 0,
    lastTickSummary: state.lastTickSummary ?? null
  };
}

export function registerRuntimeHooks(hooks: RuntimeHooks): void {
  getRuntimeState().hooks = hooks;
}

export function getRuntimeHooks(): RuntimeHooks | undefined {
  return getRuntimeState().hooks;
}

export function isDemoMode(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.LUTIC_DEMO_MODE !== "false";
}

/** Code Mode executes user-authored JavaScript and is restricted to trusted development and tests. */
export function isCodeModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "development" || env.NODE_ENV === "test";
}

export function shouldSkipAutoRuntime(): boolean {
  if (process.env.LUTIC_RUNTIME_DISABLED === "true") return true;
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") return true;
  if (process.env.NEXT_PHASE === "phase-production-build") return true;
  if (
    typeof process !== "undefined" &&
    Array.isArray(process.argv) &&
    process.argv.some((arg) => arg.includes("vitest") || arg.endsWith("run.ts"))
  ) {
    return true;
  }
  return false;
}

function compareMetric(
  value: number,
  operator: "gt" | "gte" | "lt" | "lte" | "eq",
  threshold: number
): boolean {
  switch (operator) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return value === threshold;
  }
}

async function executeRuntimeTick(
  db: LuticDatabase,
  now: Date,
  options?: RuntimeTickOptions
): Promise<RuntimeTickSummary> {
  const demo = isDemoMode();
  const scope = options?.scope;
  const overrideMap = new Map(
    (options?.telemetryOverrides ?? []).map((o) => [o.machineId, o])
  );

  // 1. Simulated machine telemetry
  const machineAssets = demo ? await db
    .select()
    .from(assets)
    .where(and(
      eq(assets.type, "machine"),
      scope ? eq(assets.tenantId, scope.tenantId) : undefined,
      scope ? inArray(assets.plantId, scope.plantIds) : undefined,
      scope?.machineId ? eq(assets.id, scope.machineId) : undefined
    )) : [];

  const readingRows: Array<typeof readings.$inferInsert> = [];
  let telemetryUpdated = 0;

  for (const m of machineAssets) {
    const ov = overrideMap.get(m.id);
    const vib =
      ov?.vibration ??
      (m.id === "mach-l3-filler-01"
        ? 7.6
        : Number((1.4 + Math.random() * 2.0).toFixed(2)));
    const temp =
      ov?.temperature ??
      (m.id === "mach-l1-cnc-01"
        ? 80.5
        : Number((43 + Math.random() * 12).toFixed(1)));
    const speed =
      ov?.currentSpeed ??
      (m.id === "mach-l3-filler-01" && !ov ? 0 : Math.round(84 + Math.random() * 15));

    const updateSet: {
      vibration: number;
      temperature: number;
      currentSpeed: number;
      pressure?: number;
      status?: "running" | "idle" | "fault" | "offline";
      updatedAt: Date;
    } = {
      vibration: vib,
      temperature: temp,
      currentSpeed: speed,
      updatedAt: now
    };
    if (ov?.pressure !== undefined) updateSet.pressure = ov.pressure;
    if (ov?.status !== undefined) updateSet.status = ov.status;

    await db
      .update(machineStatus)
      .set(updateSet)
      .where(eq(machineStatus.machineId, m.id));

    readingRows.push(
      {
        id: `rt-${m.id}-vib-${now.getTime()}-${crypto.randomUUID().slice(0, 4)}`,
        tenantId: m.tenantId,
        plantId: m.plantId,
        machineId: m.id,
        tag: "vibration",
        ts: now,
        value: vib,
        unit: "mm/s",
        quality: "good"
      },
      {
        id: `rt-${m.id}-tmp-${now.getTime()}-${crypto.randomUUID().slice(0, 4)}`,
        tenantId: m.tenantId,
        plantId: m.plantId,
        machineId: m.id,
        tag: "temperature",
        ts: now,
        value: temp,
        unit: "C",
        quality: "good"
      }
    );
    telemetryUpdated += 1;
  }

  if (readingRows.length > 0) {
    await db.insert(readings).values(readingRows);
  }

  // 2. Alert rule threshold evaluation
  const enabledRules = await db
    .select()
    .from(alertRules)
    .where(and(
      eq(alertRules.enabled, true),
      scope ? eq(alertRules.tenantId, scope.tenantId) : undefined,
      scope ? inArray(alertRules.plantId, scope.plantIds) : undefined,
      scope?.machineId ? eq(alertRules.machineId, scope.machineId) : undefined
    ))
    .orderBy(sql`${alertRules.lastEvaluatedAt} ASC NULLS FIRST`, asc(alertRules.id))
    .limit(250);

  let rulesEvaluated = 0;
  let alertsTriggered = 0;
  let alertsResolved = 0;

  for (const rule of enabledRules) {
    let metricValue: number | null = null;
    const minTimestamp = new Date(now.getTime() - rule.evaluationWindowMin * 60_000);
    if (rule.machineId) {
      const msRows = await db
        .select()
        .from(machineStatus)
        .where(and(
          eq(machineStatus.machineId, rule.machineId),
          eq(machineStatus.tenantId, rule.tenantId),
          rule.plantId ? eq(machineStatus.plantId, rule.plantId) : undefined,
          gte(machineStatus.updatedAt, minTimestamp),
          lte(machineStatus.updatedAt, now)
        ))
        .limit(1);
      const ms = msRows[0];
      if (ms) {
        if (rule.metricTag === "vibration") metricValue = ms.vibration;
        else if (rule.metricTag === "temperature") metricValue = ms.temperature;
        else if (rule.metricTag === "pressure") metricValue = ms.pressure;
        else if (rule.metricTag === "currentSpeed" || rule.metricTag === "speed") {
          metricValue = ms.currentSpeed;
        }
      }
    }

    if (metricValue === null) {
      const latestReading = await db
        .select()
        .from(readings)
        .where(and(
          eq(readings.tenantId, rule.tenantId),
          rule.plantId ? eq(readings.plantId, rule.plantId) : undefined,
          rule.machineId ? eq(readings.machineId, rule.machineId) : undefined,
          eq(readings.tag, rule.metricTag === "currentSpeed" ? "speed" : rule.metricTag),
          eq(readings.quality, "good"),
          gte(readings.ts, minTimestamp),
          lte(readings.ts, now)
        ))
        .orderBy(desc(readings.ts))
        .limit(1);
      if (latestReading[0]) {
        metricValue = latestReading[0].value;
      }
    }

    rulesEvaluated += 1;
    if (metricValue === null) {
      await db
        .update(alertRules)
        .set({ state: "INSUFFICIENT_DATA", lastEvaluatedAt: now, updatedAt: now })
        .where(eq(alertRules.id, rule.id));
      continue;
    }

    const breached = compareMetric(metricValue, rule.operator, rule.threshold);
    await db
      .update(alertRules)
      .set({
        state: breached ? "ALARM" : "OK",
        lastEvaluatedAt: now,
        updatedAt: now
      })
      .where(eq(alertRules.id, rule.id));

    if (breached) {
      const openEvents = await db
        .select({ id: alertEvents.id })
        .from(alertEvents)
        .where(
          and(
            eq(alertEvents.ruleId, rule.id),
            eq(alertEvents.tenantId, rule.tenantId),
            inArray(alertEvents.status, ["ALARM", "ACKNOWLEDGED"])
          )
        )
        .limit(1);

      if (openEvents.length === 0) {
        const alertId = `ae-${crypto.randomUUID().slice(0, 12)}`;
        const detail = `${rule.metricTag} = ${metricValue} (${rule.operator} ${rule.threshold})`;
        await db.insert(alertEvents).values({
          id: alertId,
          tenantId: rule.tenantId,
          ruleId: rule.id,
          plantId: rule.plantId,
          machineId: rule.machineId,
          status: "ALARM",
          severity: rule.severity,
          title: rule.name,
          message: detail,
          metricTag: rule.metricTag,
          metricValue,
          threshold: rule.threshold,
          triggeredAt: now
        });

        await db.insert(notifications).values({
          id: `notif-${crypto.randomUUID().slice(0, 12)}`,
          tenantId: rule.tenantId,
          userId: null,
          topicId: rule.notifyTopicId,
          channel: "alert",
          severity:
            rule.severity === "critical"
              ? "critical"
              : rule.severity === "high"
                ? "high"
                : "warning",
          title: `ALARM: ${rule.name}`,
          body: detail,
          metadata: {
            alertEventId: alertId,
            ruleId: rule.id,
            machineId: rule.machineId
          },
          read: false
        });

        const queuedWorkflowIds = new Set<string>();
        if (rule.notifyTopicId) {
          const subs = await db
            .select()
            .from(subscriptions)
            .where(
              and(
                eq(subscriptions.topicId, rule.notifyTopicId),
                eq(subscriptions.tenantId, rule.tenantId),
                eq(subscriptions.enabled, true)
              )
            );
          for (const sub of subs) {
            if (sub.protocol === "queue") {
              const [queue] = await db.select({ id: queues.id }).from(queues).where(and(
                eq(queues.id, sub.endpoint), eq(queues.tenantId, rule.tenantId)
              )).limit(1);
              if (!queue) continue;
              await db.insert(queueMessages).values({
                id: `qmsg-${crypto.randomUUID().slice(0, 12)}`,
                tenantId: rule.tenantId,
                queueId: sub.endpoint,
                body: {
                  alertEventId: alertId,
                  ruleId: rule.id,
                  machineId: rule.machineId,
                  metricTag: rule.metricTag,
                  metricValue
                },
                attributes: { severity: rule.severity, source: "alert_rule" },
                status: "ready",
                receiveCount: 0,
                visibleAt: now,
                enqueuedAt: now
              });
            } else if (sub.protocol === "workflow") {
              queuedWorkflowIds.add(sub.endpoint);
            }
          }
        }

        if (rule.workflowId) {
          queuedWorkflowIds.add(rule.workflowId);
        }

        for (const wfId of queuedWorkflowIds) {
          const [workflow] = await db.select({ version: workflows.currentVersion }).from(workflows).where(and(
            eq(workflows.id, wfId),
            eq(workflows.tenantId, rule.tenantId),
            eq(workflows.enabled, true)
          )).limit(1);
          if (!workflow) continue;
          await db.insert(workflowRuns).values({
            id: `wfr-${crypto.randomUUID().slice(0, 12)}`,
            tenantId: rule.tenantId,
            workflowId: wfId,
            version: workflow.version,
            status: "queued",
            triggerSource: "alert",
            triggeredBy: "runtime",
            input: {
              alertEventId: alertId,
              ruleId: rule.id,
              machineId: rule.machineId,
              metricTag: rule.metricTag,
              metricValue
            },
            stepTraces: [],
            startedAt: now
          });
        }

        alertsTriggered += 1;
      }
    } else {
      const activeAlarms = await db
        .select({ id: alertEvents.id })
        .from(alertEvents)
        .where(
          and(
            eq(alertEvents.ruleId, rule.id),
            eq(alertEvents.status, "ALARM")
          )
        );
      if (activeAlarms.length > 0) {
        await db
          .update(alertEvents)
          .set({
            status: "RESOLVED",
            resolvedBy: "runtime",
            resolvedAt: now
          })
          .where(
            and(
              eq(alertEvents.ruleId, rule.id),
              eq(alertEvents.status, "ALARM")
            )
          );
        alertsResolved += activeAlarms.length;
      }
    }
  }

  // 3. Due connector sync & triggers
  const connections = demo && (!scope || options?.forceConnectorSync) ? await db
    .select()
    .from(connectorConnections)
    .where(and(
      eq(connectorConnections.status, "connected"),
      scope ? eq(connectorConnections.tenantId, scope.tenantId) : undefined
    )) : [];

  let connectorsSynced = 0;
  for (const conn of connections) {
    const syncIntervalSec =
      typeof conn.config?.syncIntervalSec === "number"
        ? conn.config.syncIntervalSec
        : 60;
    const due =
      options?.forceConnectorSync ||
      !conn.lastSyncAt ||
      now.getTime() - conn.lastSyncAt.getTime() >= syncIntervalSec * 1000;
    if (!due) continue;

    await db
      .update(connectorConnections)
      .set({ lastSyncAt: now, updatedAt: now })
      .where(eq(connectorConnections.id, conn.id));

    await db.insert(connectorSyncLogs).values({
      id: `csl-${crypto.randomUUID().slice(0, 12)}`,
      tenantId: conn.tenantId,
      connectionId: conn.id,
      direction: "inbound",
      status: "success",
      recordsSynced: 1,
      latencyMs: 5,
      message: `Simulated periodic sync for ${conn.slug}`,
      payload: { syncedAt: now.toISOString(), simulated: true }
    });
    connectorsSynced += 1;
  }

  const triggers = demo && (!scope || options?.forceTriggers) ? await db
    .select()
    .from(connectorTriggers)
    .where(and(
      eq(connectorTriggers.enabled, true),
      scope ? eq(connectorTriggers.tenantId, scope.tenantId) : undefined
    )) : [];

  let triggersFired = 0;
  for (const trig of triggers) {
    const intervalSec =
      typeof trig.config?.intervalSec === "number" ? trig.config.intervalSec : 60;
    const due =
      options?.forceTriggers ||
      !trig.lastFiredAt ||
      now.getTime() - trig.lastFiredAt.getTime() >= intervalSec * 1000;
    if (!due) continue;

    await db
      .update(connectorTriggers)
      .set({ lastFiredAt: now })
      .where(eq(connectorTriggers.id, trig.id));

    if (trig.workflowId) {
      await db.insert(workflowRuns).values({
        id: `wfr-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: trig.tenantId,
        workflowId: trig.workflowId,
        version: 1,
        status: "queued",
        triggerSource: "connector",
        triggeredBy: trig.id,
        input: { eventType: trig.eventType, triggerId: trig.id },
        stepTraces: [],
        startedAt: now
      });
    }
    triggersFired += 1;
  }

  // 4. Queue visibility timeout & DLQ sweep + scheduled workflows
  const queueSweep = scope ? { requeued: 0, deadLettered: 0 } : await sweepQueueVisibilityTimeouts(db);

  let scheduledWorkflowsQueued = 0;
  const scheduledWfs = scope ? [] : await db
    .select()
    .from(workflows)
    .where(and(
      eq(workflows.enabled, true),
      eq(workflows.triggerType, "schedule"),
      sql`NOT EXISTS (
        SELECT 1 FROM workflow_runs
        WHERE tenant_id = ${workflows.tenantId} AND workflow_id = ${workflows.id}
          AND trigger_source = 'schedule'
          AND (status IN ('queued', 'running') OR started_at > ${now.toISOString()}::timestamptz - (
            CASE WHEN jsonb_typeof(${workflows.triggerConfig}->'intervalSec') = 'number'
                 THEN GREATEST(1, LEAST(31536000, (${workflows.triggerConfig}->>'intervalSec')::numeric))
                 ELSE 300 END
          ) * interval '1 second')
      )`
    ))
    .orderBy(asc(workflows.id))
    .limit(250);

  for (const wf of scheduledWfs) {
    await db.insert(workflowRuns).values({
      id: `wfr-${crypto.randomUUID().slice(0, 12)}`,
      tenantId: wf.tenantId,
      workflowId: wf.id,
      version: wf.currentVersion,
      status: "queued",
      triggerSource: "schedule",
      triggeredBy: "runtime",
      input: {},
      stepTraces: [],
      startedAt: now
    });
    scheduledWorkflowsQueued += 1;
  }

  if (!scope) await pruneExpiredRateLimits(db);

  return {
    tickAt: now.toISOString(),
    telemetryUpdated,
    rulesEvaluated,
    alertsTriggered,
    alertsResolved,
    connectorsSynced,
    triggersFired,
    queueMessagesRequeued: queueSweep.requeued,
    queueMessagesDeadLettered: queueSweep.deadLettered,
    scheduledWorkflowsQueued
  };
}

export async function runRuntimeTick(
  db: LuticDatabase,
  options?: RuntimeTickOptions
): Promise<RuntimeTickSummary> {
  const started = Date.now();
  const state = getRuntimeState();
  let summary: RuntimeTickSummary | undefined;
  try {
    summary = await db.transaction(async (tx) => {
      const lock = await tx.execute<{ acquired: boolean; tick_at: string }>(sql`
        SELECT pg_try_advisory_xact_lock(hashtext('lutic.runtime'), 1) AS acquired,
          clock_timestamp()::text AS tick_at
      `);
      const [tick] = lock.rows;
      if (!tick?.acquired) return undefined;
      await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
      await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
      return executeRuntimeTick(tx as unknown as LuticDatabase, new Date(tick.tick_at), options);
    });
  } catch (err) {
    state.lastTickAt = new Date().toISOString();
    state.lastTickDurationMs = Date.now() - started;
    state.lastTickError = err instanceof Error ? err.message : String(err);
    throw err;
  }
  if (!summary) {
    return {
      tickAt: new Date().toISOString(),
      telemetryUpdated: 0,
      rulesEvaluated: 0,
      alertsTriggered: 0,
      alertsResolved: 0,
      connectorsSynced: 0,
      triggersFired: 0,
      queueMessagesRequeued: 0,
      queueMessagesDeadLettered: 0,
      scheduledWorkflowsQueued: 0,
      skipped: "busy"
    };
  }

  const executeRun = options?.scope ? options.executeWorkflowRun : getRuntimeHooks()?.executeWorkflowRun;
  if (executeRun) {
    const scope = options?.scope;
    const queuedRuns = await db
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .innerJoin(workflows, and(eq(workflows.id, workflowRuns.workflowId), eq(workflows.tenantId, workflowRuns.tenantId)))
      .where(and(
        eq(workflowRuns.status, "queued"),
        scope ? eq(workflowRuns.tenantId, scope.tenantId) : undefined,
        scope ? inArray(workflows.plantId, scope.plantIds) : undefined
      ))
      .orderBy(asc(workflowRuns.startedAt), asc(workflowRuns.id))
      .limit(10);
    for (const run of queuedRuns) {
      await executeRun(db, run.id);
    }
  }
  state.lastTickAt = summary.tickAt;
  state.lastTickDurationMs = Date.now() - started;
  state.lastTickError = null;
  state.tickCount = (state.tickCount ?? 0) + 1;
  state.lastTickSummary = summary;
  return summary;
}

export function startBackgroundRuntime(
  getDb: () => Promise<LuticDatabase>,
  intervalMs = Number(process.env.RUNTIME_TICK_INTERVAL_MS ?? 15000)
): void {
  if (shouldSkipAutoRuntime()) return;
  const state = getRuntimeState();
  if (state.timer) return;
  state.startedAt = new Date().toISOString();

  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runRuntimeTick(await getDb());
    } catch (err) {
      state.lastTickError = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, "Background runtime tick failed");
    } finally {
      running = false;
    }
  }, Number.isFinite(intervalMs) && intervalMs >= 1000 ? intervalMs : 15000);

  timer.unref?.();
  state.timer = timer;
}

export function stopBackgroundRuntime(): void {
  const state = getRuntimeState();
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = undefined;
  }
}
