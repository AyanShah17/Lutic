import { NextResponse } from "next/server";
import {
  and,
  assets,
  authorize,
  eq,
  getAppliedMigrations,
  getConfiguredRetentionDays,
  getLicenseStatus,
  getRuntimeHealthSnapshot,
  inArray,
  machineStatus,
  queueMessages,
  sql
} from "@kojo/core";
import { checkScannerHealth } from "@kojo/agent";
import { getWebAdministrativeDb, getWebDbConnection, requireWebLicense, withWebTenantDb } from "@/lib/db";
import { getSessionUser, handleApiError, problemResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

const STALE_TELEMETRY_MS = 15 * 60 * 1000;

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "admin:audit", { tenantId: user.tenantId });

    const adminDb = await getWebAdministrativeDb();
    const dbStart = Date.now();
    await adminDb.execute(sql`SELECT 1`);
    const dbLatencyMs = Date.now() - dbStart;

    const conn = await getWebDbConnection();
    const [poolStats, license, scanner, migrations] = await Promise.all([
      Promise.resolve(conn.getPoolStats?.() ?? null),
      getLicenseStatus(adminDb),
      checkScannerHealth(),
      getAppliedMigrations(conn).catch(() => [])
    ]);

    const runtime = getRuntimeHealthSnapshot();
    const retentionDays = getConfiguredRetentionDays();
    const nowMs = Date.now();

    const tenantSignals = await withWebTenantDb(user.tenantId, async (db) => {
      const [machineRows, statusRows, queueRows] = await Promise.all([
        db
          .select({ id: assets.id })
          .from(assets)
          .where(
            and(
              eq(assets.tenantId, user.tenantId),
              eq(assets.type, "machine"),
              inArray(assets.plantId, user.plantIds)
            )
          ),
        db
          .select({ machineId: machineStatus.machineId, updatedAt: machineStatus.updatedAt })
          .from(machineStatus)
          .where(
            and(
              eq(machineStatus.tenantId, user.tenantId),
              inArray(machineStatus.plantId, user.plantIds)
            )
          ),
        db
          .select({ status: queueMessages.status })
          .from(queueMessages)
          .where(
            and(
              eq(queueMessages.tenantId, user.tenantId),
              inArray(queueMessages.status, ["ready", "in_flight", "dead_letter"])
            )
          )
      ]);

      const statusByMachine = new Map(statusRows.map((row) => [row.machineId, row.updatedAt]));
      let missingTelemetry = 0;
      let staleMachines = 0;
      let latestMs = 0;

      for (const machine of machineRows) {
        const updatedAt = statusByMachine.get(machine.id);
        if (!updatedAt) {
          missingTelemetry += 1;
          continue;
        }
        const tsMs = new Date(updatedAt).getTime();
        if (tsMs > latestMs) latestMs = tsMs;
        if (nowMs - tsMs > STALE_TELEMETRY_MS) {
          staleMachines += 1;
        }
      }

      let ready = 0;
      let inFlight = 0;
      let deadLetter = 0;
      for (const row of queueRows) {
        if (row.status === "ready") ready += 1;
        else if (row.status === "in_flight") inFlight += 1;
        else if (row.status === "dead_letter") deadLetter += 1;
      }

      return {
        telemetry: {
          totalMachines: machineRows.length,
          machinesWithTelemetry: machineRows.length - missingTelemetry,
          missingTelemetry,
          staleMachines,
          staleThresholdMinutes: STALE_TELEMETRY_MS / 60_000,
          latestTelemetryAt: latestMs > 0 ? new Date(latestMs).toISOString() : null
        },
        queues: {
          ready,
          inFlight,
          deadLetter
        }
      };
    });

    return NextResponse.json({
      checkedAt: new Date(nowMs).toISOString(),
      database: {
        status: "ok",
        latencyMs: dbLatencyMs,
        pool: poolStats
      },
      runtime,
      scanner,
      license: {
        enforced: license.enforced,
        status: license.status,
        active: license.active,
        plan: license.plan,
        expiresAt: license.expiresAt ?? null
      },
      migrations: {
        currentVersion: migrations.at(-1)?.version ?? 0,
        applied: migrations
      },
      retention: {
        configuredDays: retentionDays
      },
      ...tenantSignals
    });
  } catch (err) {
    return handleApiError(err);
  }
}
