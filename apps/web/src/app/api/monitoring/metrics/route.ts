import { NextResponse } from "next/server";
import {
  alarms,
  alertEvents,
  alertRules,
  and,
  asc,
  assets,
  authorize,
  desc,
  eq,
  inArray,
  isNull,
  machineStatus,
  or,
  PostgresTimeSeriesStore,
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { getSessionUser, handleApiError, problemResponse } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "machine:read", { tenantId: user.tenantId });

    const url = new URL(req.url);
    const machineId = url.searchParams.get("machineId")?.trim() || undefined;
    const tag = url.searchParams.get("tag")?.trim() || undefined;
    const hoursParam = Number(url.searchParams.get("hours") ?? "24");
    const hours = Number.isFinite(hoursParam)
      ? Math.min(Math.max(hoursParam, 1), 24 * 30)
      : 24;

    if (user.plantIds.length === 0) {
      return NextResponse.json({
        machines: [],
        metrics: [],
        readings: [],
        series: [],
        points: [],
        summary: { totalMachines: 0, faultedMachines: 0, activeAlarms: 0 }
      });
    }

    return await withWebTenantDb(user.tenantId, async (db) => {
      if (machineId) {
        const mCheck = await db
          .select({ id: assets.id, plantId: assets.plantId })
          .from(assets)
          .where(and(eq(assets.id, machineId), eq(assets.tenantId, user.tenantId)))
          .limit(1);
        if (!mCheck[0]) {
          return problemResponse(404, "Not Found", "Machine not found.");
        }
        if (!user.plantIds.includes(mCheck[0].plantId)) {
          return problemResponse(
            403,
            "Forbidden",
            "Machine belongs to a plant outside your scope."
          );
        }
      }

      const machineConds = [
        eq(assets.tenantId, user.tenantId),
        eq(assets.type, "machine"),
        inArray(assets.plantId, user.plantIds)
      ];
      if (machineId) machineConds.push(eq(assets.id, machineId));

      const machineRows = await db
        .select({
          id: assets.id,
          name: assets.name,
          plantId: assets.plantId,
          machineType: assets.machineType,
          status: machineStatus.status,
          temperature: machineStatus.temperature,
          vibration: machineStatus.vibration,
          pressure: machineStatus.pressure,
          currentSpeed: machineStatus.currentSpeed,
          updatedAt: machineStatus.updatedAt
        })
        .from(assets)
        .leftJoin(machineStatus, eq(machineStatus.machineId, assets.id))
        .where(and(...machineConds))
        .orderBy(asc(assets.id));

      const targetMachineId = machineId ?? machineRows[0]?.id;
      let series: Array<{
        bucketStart: string;
        tag: string;
        unit: string;
        avg: number;
        min: number;
        max: number;
        count: number;
      }> = [];

      if (targetMachineId) {
        const store = new PostgresTimeSeriesStore(db);
        const agg = await store.queryAggregatedReadings({
          tenantId: user.tenantId,
          machineId: targetMachineId,
          tag,
          hours,
          maxBuckets: 48
        });
        series = agg.buckets;
      }

      const [activeAlarms, activeEvents, rules] = await Promise.all([
        db
          .select()
          .from(alarms)
          .where(
            and(
              eq(alarms.tenantId, user.tenantId),
              inArray(alarms.plantId, user.plantIds),
              isNull(alarms.clearedAt)
            )
          ),
        db
          .select()
          .from(alertEvents)
          .where(
            and(
              eq(alertEvents.tenantId, user.tenantId),
              or(
                isNull(alertEvents.plantId),
                inArray(alertEvents.plantId, user.plantIds)
              )
            )
          )
          .orderBy(desc(alertEvents.triggeredAt))
          .limit(30),
        db
          .select()
          .from(alertRules)
          .where(eq(alertRules.tenantId, user.tenantId))
      ]);

      return NextResponse.json({
        machineId: targetMachineId ?? null,
        machines: machineRows,
        metrics: machineRows,
        readings: series,
        series,
        points: series,
        activeAlarmsCount: activeAlarms.length,
        summary: {
          totalMachines: machineRows.length,
          faultedMachines: machineRows.filter((m) => m.status === "fault").length,
          alarmRulesInAlarm: rules.filter((r) => r.state === "ALARM").length,
          openAlertEvents: activeEvents.filter((e) => e.status === "ALARM").length
        }
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
