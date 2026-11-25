import crypto from "node:crypto";
import os from "node:os";
import type { LuticDatabase } from "../packages/core/src/db/client";
import { createDbConnection } from "../packages/core/src/db/client";
import { ensureSchema } from "../packages/core/src/db/migrate";
import { workerHeartbeats } from "../packages/core/src/db/schema";
import { sql } from "../packages/core/src/index";
import { validateProductionConfig } from "../packages/core/src/production-config";
import { isDemoMode, runRuntimeTick } from "../packages/core/src/runtime";
import { registerWorkflowAiExecutor } from "../packages/core/src/workflows";
import { executeWorkflowAiNodeWithLlm } from "../packages/agent/src/orchestrator";

export { executeWorkflowAiNodeWithLlm };

export async function runWorkerTickOnce(
  db: LuticDatabase,
  options: { workerId: string; hostname: string; startedAt: Date; tickCount: number }
) {
  const startedMs = Date.now();
  const lockRows = await db.execute<{ acquired: boolean }>(
    sql`SELECT pg_try_advisory_lock(hashtext('lutic.worker.tick'), 1) AS acquired`
  );
  if (!lockRows.rows[0]?.acquired) {
    return { skipped: "worker_lock_busy" as const, tickCount: options.tickCount };
  }

  try {
    let tickError: string | null = null;
    let summary: Record<string, unknown> = {};
    let nextTickCount = options.tickCount;
    try {
      const tickRes = await runRuntimeTick(db);
      summary = tickRes as unknown as Record<string, unknown>;
      nextTickCount += 1;
    } catch (err) {
      tickError = err instanceof Error ? err.message : String(err);
    }

    const now = new Date();
    const durationMs = Math.max(1, Date.now() - startedMs);
    await db
      .insert(workerHeartbeats)
      .values({
        workerId: options.workerId,
        hostname: options.hostname,
        startedAt: options.startedAt,
        lastTickAt: now,
        lastTickDurationMs: durationMs,
        tickCount: nextTickCount,
        lastError: tickError,
        summary,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: workerHeartbeats.workerId,
        set: {
          hostname: options.hostname,
          lastTickAt: now,
          lastTickDurationMs: durationMs,
          tickCount: nextTickCount,
          lastError: tickError,
          summary,
          updatedAt: now
        }
      });

    if (tickError) {
      throw new Error(tickError);
    }
    return { skipped: null, tickCount: nextTickCount, summary };
  } finally {
    await db
      .execute(sql`SELECT pg_advisory_unlock(hashtext('lutic.worker.tick'), 1)`)
      .catch(() => undefined);
  }
}

async function startWorkerMain(): Promise<void> {
  if (!isDemoMode()) {
    validateProductionConfig();
  }
  const conn = await createDbConnection();
  await ensureSchema(conn);
  registerWorkflowAiExecutor(executeWorkflowAiNodeWithLlm);

  const workerId = process.env.LUTIC_WORKER_ID ?? `worker-${os.hostname()}-${crypto.randomUUID().slice(0, 8)}`;
  const hostname = os.hostname();
  const startedAt = new Date();
  const intervalMs = Math.max(1000, Number(process.env.RUNTIME_TICK_INTERVAL_MS ?? 15000) || 15000);
  let tickCount = 0;
  let running = false;
  let stopping = false;

  const tick = async () => {
    if (running || stopping) return;
    running = true;
    try {
      const res = await runWorkerTickOnce(conn.db, { workerId, hostname, startedAt, tickCount });
      tickCount = res.tickCount;
    } catch (err) {
      console.error(`Lutic worker tick error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };

  await tick();
  const timer = setInterval(() => void tick(), intervalMs);

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await conn.close().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

if (import.meta.main) {
  startWorkerMain().catch((err) => {
    console.error(`Lutic worker startup failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
