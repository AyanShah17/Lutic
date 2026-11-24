import crypto from "node:crypto";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import type { LuticDatabase } from "./db/client";
import {
  notifications,
  queueMessages,
  queues,
  subscriptions,
  topics,
  users,
  workflowRuns,
  workflows
} from "./db/schema";
import { getRuntimeHooks, isDemoMode } from "./runtime";

type WorkflowRunExecutor = (db: LuticDatabase, runId: string) => Promise<void>;
let registeredWorkflowExecutor: WorkflowRunExecutor | undefined;

export function registerTopicWorkflowExecutor(fn: WorkflowRunExecutor): void {
  registeredWorkflowExecutor = fn;
}

export interface PublishTopicInput {
  subject?: string;
  title?: string;
  message?: string;
  body?: string;
  severity?: "info" | "warning" | "high" | "critical";
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface PublishTopicResult {
  ok: boolean;
  topicId: string;
  deliveries: {
    inApp: number;
    queues: number;
    workflows: number;
    webhooks: number;
  };
  deliveryFailures: Array<{ subscriptionId: string; reason: string }>;
  workflowRunIds: string[];
}

function normalizeSeverity(
  sev?: string
): "info" | "warning" | "high" | "critical" {
  if (sev === "warning" || sev === "high" || sev === "critical") return sev;
  return "info";
}

function matchesFilterPolicy(
  filterPolicy: Record<string, unknown>,
  attributes: Record<string, unknown>
): boolean {
  const entries = Object.entries(filterPolicy);
  if (entries.length === 0) return true;
  for (const [key, expected] of entries) {
    const actual = attributes[key];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

export async function publishToTopic(
  db: LuticDatabase,
  tenantId: string,
  topicId: string,
  input: PublishTopicInput
): Promise<PublishTopicResult> {
  const topicRows = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.tenantId, tenantId)))
    .limit(1);

  const topic = topicRows[0];
  if (!topic) {
    throw new Error(`Topic '${topicId}' not found`);
  }

  const now = new Date();
  const title = (input.subject || input.title || topic.name).trim();
  const body = (
    input.message ||
    input.body ||
    (input.payload ? JSON.stringify(input.payload) : topic.description || topic.name)
  ).trim();
  const severity = normalizeSeverity(input.severity);
  const metadata = {
    ...(input.metadata ?? {}),
    ...(input.payload ?? {}),
    topicName: topic.name
  };

  const subs = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.tenantId, tenantId),
        eq(subscriptions.topicId, topicId),
        eq(subscriptions.enabled, true)
      )
    );

  const deliveries = { inApp: 0, queues: 0, workflows: 0, webhooks: 0 };
  const deliveryFailures: PublishTopicResult["deliveryFailures"] = [];
  const workflowRunIds: string[] = [];

  for (const sub of subs) {
    if (!matchesFilterPolicy(sub.filterPolicy ?? {}, metadata)) continue;

    if (sub.protocol === "in_app") {
      let targetUserId: string | null = null;
      if (sub.endpoint && sub.endpoint !== "all" && sub.endpoint !== "*") {
        const uRows = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, sub.endpoint), eq(users.tenantId, tenantId)))
          .limit(1);
        if (uRows[0]) {
          targetUserId = uRows[0].id;
        }
      }

      await db.insert(notifications).values({
        id: `notif-${crypto.randomUUID().slice(0, 12)}`,
        tenantId,
        userId: targetUserId,
        topicId,
        channel: "in_app",
        severity,
        title,
        body,
        metadata:
          sub.endpoint && !targetUserId && sub.endpoint !== "all"
            ? { ...metadata, targetEndpoint: sub.endpoint }
            : metadata,
        read: false,
        createdAt: now
      });
      deliveries.inApp += 1;
    } else if (sub.protocol === "queue") {
      const qRows = await db
        .select({ id: queues.id })
        .from(queues)
        .where(and(eq(queues.id, sub.endpoint), eq(queues.tenantId, tenantId)))
        .limit(1);
      if (qRows[0]) {
        await db.insert(queueMessages).values({
          id: `qmsg-${crypto.randomUUID().slice(0, 12)}`,
          tenantId,
          queueId: sub.endpoint,
          body: {
            topicId,
            topicName: topic.name,
            subject: title,
            message: body,
            ...(input.payload ?? {})
          },
          attributes: { severity, source: "topic_fanout" },
          status: "ready",
          receiveCount: 0,
          visibleAt: now,
          enqueuedAt: now
        });
        deliveries.queues += 1;
      }
    } else if (sub.protocol === "workflow") {
      const wfRows = await db
        .select({
          id: workflows.id,
          currentVersion: workflows.currentVersion,
          enabled: workflows.enabled
        })
        .from(workflows)
        .where(
          and(
            eq(workflows.id, sub.endpoint),
            eq(workflows.tenantId, tenantId),
            eq(workflows.enabled, true)
          )
        )
        .limit(1);

      if (wfRows[0]) {
        const runId = `wfr-${crypto.randomUUID().slice(0, 12)}`;
        await db.insert(workflowRuns).values({
          id: runId,
          tenantId,
          workflowId: wfRows[0].id,
          version: wfRows[0].currentVersion,
          status: "queued",
          triggerSource: "topic",
          triggeredBy: topicId,
          input: { topicId, subject: title, message: body, ...metadata },
          stepTraces: [],
          startedAt: now
        });
        const exec = registeredWorkflowExecutor ?? getRuntimeHooks()?.executeWorkflowRun;
        if (exec) {
          await exec(db, runId);
        }
        workflowRunIds.push(runId);
        deliveries.workflows += 1;
      }
    } else if (sub.protocol === "webhook") {
      if (!isDemoMode()) {
        deliveryFailures.push({ subscriptionId: sub.id, reason: "Webhook delivery is unavailable" });
        continue;
      }
      await db.insert(notifications).values({
        id: `notif-${crypto.randomUUID().slice(0, 12)}`,
        tenantId,
        userId: null,
        topicId,
        channel: "local_push",
        severity,
        title: `Webhook Dispatched: ${title}`,
        body: `Delivered to ${sub.endpoint}: ${body}`,
        metadata: { ...metadata, webhookEndpoint: sub.endpoint },
        read: false,
        createdAt: now
      });
      deliveries.webhooks += 1;
    }
  }

  return {
    ok: deliveryFailures.length === 0,
    topicId,
    deliveries,
    deliveryFailures,
    workflowRunIds
  };
}

export async function enqueueQueueMessage(
  db: LuticDatabase,
  tenantId: string,
  queueId: string,
  input: {
    body?: Record<string, unknown>;
    payload?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    delaySeconds?: number;
  }
) {
  const qRows = await db
    .select()
    .from(queues)
    .where(and(eq(queues.id, queueId), eq(queues.tenantId, tenantId)))
    .limit(1);

  if (!qRows[0]) {
    throw new Error(`Queue '${queueId}' not found`);
  }

  const now = new Date();
  const visibleAt = input.delaySeconds
    ? new Date(now.getTime() + Math.max(0, input.delaySeconds) * 1000)
    : now;

  const id = `qmsg-${crypto.randomUUID().slice(0, 12)}`;
  const msgBody = input.body ?? input.payload ?? {};
  const row = {
    id,
    tenantId,
    queueId,
    body: msgBody,
    attributes: input.attributes ?? {},
    status: "ready" as const,
    receiveCount: 0,
    receiptHandle: null,
    visibleAt,
    enqueuedAt: now,
    ackedAt: null
  };

  await db.insert(queueMessages).values(row);
  return { ...row, messageId: id };
}

export async function sweepExpiredInFlightMessages(
  db: LuticDatabase,
  tenantId: string,
  queueId: string
): Promise<{ requeued: number; deadLettered: number }> {
  return sweepQueueVisibilityTimeouts(db, { tenantId, queueId });
}

export async function sweepQueueVisibilityTimeouts(
  db: LuticDatabase,
  queue?: { tenantId: string; queueId: string }
): Promise<{ requeued: number; deadLettered: number }> {
  const scope = queue ? sql`AND m.tenant_id = ${queue.tenantId} AND m.queue_id = ${queue.queueId}` : sql``;
  const result = await db.execute<{ status: "ready" | "dead_letter" }>(sql`
    WITH expired AS (
      SELECT m.id, m.receive_count >= q.max_receive_count AS is_dead_letter,
             COALESCE(dlq.id, m.queue_id) AS dead_letter_queue_id
      FROM queue_messages m
      JOIN queues q ON q.id = m.queue_id AND q.tenant_id = m.tenant_id
      LEFT JOIN queues dlq ON dlq.id = q.dead_letter_queue_id AND dlq.tenant_id = q.tenant_id
      WHERE m.status = 'in_flight' AND m.visible_at <= statement_timestamp() ${scope}
      ORDER BY m.visible_at, m.id
      LIMIT 500
      FOR UPDATE OF m SKIP LOCKED
    )
    UPDATE queue_messages m
    SET status = CASE WHEN expired.is_dead_letter THEN 'dead_letter' ELSE 'ready' END,
        queue_id = CASE WHEN expired.is_dead_letter THEN expired.dead_letter_queue_id ELSE m.queue_id END,
        receipt_handle = NULL
    FROM expired
    WHERE m.id = expired.id
    RETURNING m.status
  `);
  const deadLettered = result.rows.filter((row) => row.status === "dead_letter").length;
  return { requeued: result.rows.length - deadLettered, deadLettered };
}

export async function pollQueueMessages(
  db: LuticDatabase,
  tenantId: string,
  queueId: string,
  opts?: { maxMessages?: number; visibilityTimeoutSec?: number }
) {
  const qRows = await db
    .select()
    .from(queues)
    .where(and(eq(queues.id, queueId), eq(queues.tenantId, tenantId)))
    .limit(1);

  const q = qRows[0];
  if (!q) {
    throw new Error(`Queue '${queueId}' not found`);
  }

  await sweepExpiredInFlightMessages(db, tenantId, queueId);

  const now = new Date();
  const limit = Math.min(Math.max(opts?.maxMessages ?? 5, 1), 20);
  const visSec = opts?.visibilityTimeoutSec ?? q.visibilityTimeoutSec ?? 30;
  const nextVisibleAt = new Date(now.getTime() + visSec * 1000);

  const readyRows = await db
    .select()
    .from(queueMessages)
    .where(
      and(
        eq(queueMessages.tenantId, tenantId),
        eq(queueMessages.queueId, queueId),
        eq(queueMessages.status, "ready"),
        lte(queueMessages.visibleAt, now)
      )
    )
    .orderBy(asc(queueMessages.enqueuedAt))
    .limit(limit);

  const leased = [];
  for (const msg of readyRows) {
    const receiptHandle = `rh-${crypto.randomUUID().slice(0, 12)}`;
    const nextReceive = msg.receiveCount + 1;
    const [updated] = await db
      .update(queueMessages)
      .set({
        status: "in_flight",
        receiveCount: nextReceive,
        receiptHandle,
        visibleAt: nextVisibleAt
      })
      .where(and(
        eq(queueMessages.id, msg.id),
        eq(queueMessages.queueId, queueId),
        eq(queueMessages.status, "ready"),
        eq(queueMessages.receiveCount, msg.receiveCount),
        lte(queueMessages.visibleAt, now)
      ))
      .returning();

    if (updated) leased.push({ ...updated, messageId: updated.id });
  }

  return leased;
}

export async function acknowledgeQueueMessage(
  db: LuticDatabase,
  tenantId: string,
  queueId: string,
  input: { messageId?: string; receiptHandle?: string }
): Promise<{ ok: boolean; messageId: string }> {
  if (!input.messageId && !input.receiptHandle) {
    throw new Error("messageId or receiptHandle is required");
  }

  const conds = [
    eq(queueMessages.tenantId, tenantId),
    eq(queueMessages.queueId, queueId)
  ];

  if (input.messageId) conds.push(eq(queueMessages.id, input.messageId));
  if (input.receiptHandle) {
    conds.push(eq(queueMessages.receiptHandle, input.receiptHandle));
  }

  const [target] = await db
    .update(queueMessages)
    .set({
      status: "acked",
      receiptHandle: null,
      ackedAt: new Date()
    })
    .where(and(...conds))
    .returning();
  if (!target) throw new Error("Queue message not found or receipt is stale");

  return { ok: true, messageId: target.id };
}

export async function purgeQueueMessages(
  db: LuticDatabase,
  tenantId: string,
  queueId: string
): Promise<{ ok: true; purgedCount: number }> {
  const qRows = await db
    .select({ id: queues.id })
    .from(queues)
    .where(and(eq(queues.id, queueId), eq(queues.tenantId, tenantId)))
    .limit(1);
  if (!qRows[0]) {
    throw new Error(`Queue '${queueId}' not found`);
  }

  const existing = await db
    .select({ id: queueMessages.id })
    .from(queueMessages)
    .where(
      and(
        eq(queueMessages.tenantId, tenantId),
        eq(queueMessages.queueId, queueId)
      )
    );

  if (existing.length > 0) {
    await db
      .delete(queueMessages)
      .where(
        and(
          eq(queueMessages.tenantId, tenantId),
          eq(queueMessages.queueId, queueId)
        )
      );
  }

  return { ok: true, purgedCount: existing.length };
}

export async function listQueueSummaries(
  db: LuticDatabase,
  tenantId: string
) {
  const [qRows, msgRows] = await Promise.all([
    db
      .select()
      .from(queues)
      .where(eq(queues.tenantId, tenantId))
      .orderBy(desc(queues.createdAt)),
    db
      .select({
        queueId: queueMessages.queueId,
        status: queueMessages.status
      })
      .from(queueMessages)
      .where(eq(queueMessages.tenantId, tenantId))
  ]);

  const counts = new Map<
    string,
    { ready: number; inFlight: number; deadLetter: number; acked: number }
  >();
  for (const m of msgRows) {
    const c = counts.get(m.queueId) ?? {
      ready: 0,
      inFlight: 0,
      deadLetter: 0,
      acked: 0
    };
    if (m.status === "ready") c.ready += 1;
    else if (m.status === "in_flight") c.inFlight += 1;
    else if (m.status === "dead_letter") c.deadLetter += 1;
    else if (m.status === "acked") c.acked += 1;
    counts.set(m.queueId, c);
  }

  return qRows.map((q) => {
    const c = counts.get(q.id) ?? {
      ready: 0,
      inFlight: 0,
      deadLetter: 0,
      acked: 0
    };
    return {
      ...q,
      readyCount: c.ready,
      inFlightCount: c.inFlight,
      deadLetterCount: c.deadLetter,
      ackedCount: c.acked
    };
  });
}
