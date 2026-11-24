import crypto from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { KojoDatabase } from "./db/client";
import type * as schema from "./db/schema";
import {
  auditLog,
  connectorSyncLogs,
  conversations,
  notifications,
  queueMessages,
  readings,
  revokedSessions,
  usageLog,
  workflowRuns
} from "./db/schema";
import { pruneExpiredRateLimits } from "./rate-limit";

export interface RetentionCleanupSummary {
  tenantId: string;
  retentionDays: number;
  cutoffIso: string;
  readingsDeleted: number;
  conversationsDeleted: number;
  auditLogsDeleted: number;
  usageLogsDeleted: number;
  syncLogsDeleted: number;
  workflowRunsDeleted: number;
  notificationsDeleted: number;
  revokedSessionsDeleted: number;
  ackedMessagesDeleted: number;
}

export function getConfiguredRetentionDays(): number {
  const parsed = Number(process.env.DATA_RETENTION_DAYS ?? 90);
  if (!Number.isFinite(parsed)) return 90;
  return Math.min(Math.max(Math.floor(parsed), 1), 3650);
}

export async function runRetentionCleanup(
  db: KojoDatabase,
  options: {
    tenantId: string;
    retentionDays?: number;
    actorUserId?: string;
    actorRole?: string;
  }
): Promise<RetentionCleanupSummary> {
  const days = options.retentionDays !== undefined
    ? Math.min(Math.max(Math.floor(options.retentionDays), 1), 3650)
    : getConfiguredRetentionDays();
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const typedDb = db as NodePgDatabase<typeof schema>;

  const deletedReadings = await typedDb
    .delete(readings)
    .where(and(eq(readings.tenantId, options.tenantId), lt(readings.ts, cutoff)))
    .returning({ id: readings.id });

  const deletedConversations = await typedDb
    .delete(conversations)
    .where(and(eq(conversations.tenantId, options.tenantId), lt(conversations.updatedAt, cutoff)))
    .returning({ id: conversations.id });

  const deletedAuditLogs = await typedDb
    .delete(auditLog)
    .where(and(eq(auditLog.tenantId, options.tenantId), lt(auditLog.createdAt, cutoff)))
    .returning({ id: auditLog.id });

  const deletedUsageLogs = await typedDb
    .delete(usageLog)
    .where(and(eq(usageLog.tenantId, options.tenantId), lt(usageLog.createdAt, cutoff)))
    .returning({ id: usageLog.id });

  const deletedSyncLogs = await typedDb
    .delete(connectorSyncLogs)
    .where(
      and(eq(connectorSyncLogs.tenantId, options.tenantId), lt(connectorSyncLogs.createdAt, cutoff))
    )
    .returning({ id: connectorSyncLogs.id });

  const deletedWorkflowRuns = await typedDb
    .delete(workflowRuns)
    .where(
      and(
        eq(workflowRuns.tenantId, options.tenantId),
        inArray(workflowRuns.status, ["succeeded", "failed"]),
        lt(workflowRuns.startedAt, cutoff)
      )
    )
    .returning({ id: workflowRuns.id });

  const deletedNotifications = await typedDb
    .delete(notifications)
    .where(
      and(
        eq(notifications.tenantId, options.tenantId),
        eq(notifications.read, true),
        lt(notifications.createdAt, cutoff)
      )
    )
    .returning({ id: notifications.id });

  const deletedRevokedSessions = await typedDb
    .delete(revokedSessions)
    .where(
      and(eq(revokedSessions.tenantId, options.tenantId), lt(revokedSessions.expiresAt, now))
    )
    .returning({ tokenHash: revokedSessions.tokenHash });

  const deletedAckedMessages = await typedDb
    .delete(queueMessages)
    .where(
      and(
        eq(queueMessages.tenantId, options.tenantId),
        eq(queueMessages.status, "acked"),
        lt(queueMessages.ackedAt, cutoff)
      )
    )
    .returning({ id: queueMessages.id });

  await pruneExpiredRateLimits(db);

  const summary: RetentionCleanupSummary = {
    tenantId: options.tenantId,
    retentionDays: days,
    cutoffIso: cutoff.toISOString(),
    readingsDeleted: deletedReadings.length,
    conversationsDeleted: deletedConversations.length,
    auditLogsDeleted: deletedAuditLogs.length,
    usageLogsDeleted: deletedUsageLogs.length,
    syncLogsDeleted: deletedSyncLogs.length,
    workflowRunsDeleted: deletedWorkflowRuns.length,
    notificationsDeleted: deletedNotifications.length,
    revokedSessionsDeleted: deletedRevokedSessions.length,
    ackedMessagesDeleted: deletedAckedMessages.length
  };

  if (options.actorUserId) {
    await db.insert(auditLog).values({
      id: `aud-${crypto.randomUUID().slice(0, 12)}`,
      tenantId: options.tenantId,
      userId: options.actorUserId,
      role: options.actorRole ?? "admin",
      action: "retention_cleanup",
      toolName: "admin.retention.cleanup",
      args: { retentionDays: days, cutoffIso: summary.cutoffIso },
      resultHash: "",
      status: "allowed",
      reason: `Retention cleanup applied (${days}d window)`,
      latencyMs: 1
    });
  }

  return summary;
}
