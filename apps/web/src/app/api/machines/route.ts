import { NextResponse } from "next/server";
import {
  alarms,
  and,
  assets,
  authorize,
  eq,
  inArray,
  isNull,
  machineStatus,
  plants,
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { getSessionUser, handleApiError, problemResponse } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "machine:read", { tenantId: user.tenantId });

    if (user.plantIds.length === 0) {
      return NextResponse.json({ machines: [], plants: [] });
    }

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [machineRows, activeAlarmRows, plantRows] = await Promise.all([
        db
          .select({
            id: assets.id,
            name: assets.name,
            plantId: assets.plantId,
            lineId: assets.parentId,
            machineType: assets.machineType,
            manufacturer: assets.manufacturer,
            model: assets.model,
            criticality: assets.criticality,
            status: machineStatus.status,
            temperature: machineStatus.temperature,
            vibration: machineStatus.vibration,
            pressure: machineStatus.pressure,
            updatedAt: machineStatus.updatedAt
          })
          .from(assets)
          .leftJoin(machineStatus, eq(machineStatus.machineId, assets.id))
          .where(
            and(
              eq(assets.tenantId, user.tenantId),
              eq(assets.type, "machine"),
              inArray(assets.plantId, user.plantIds)
            )
          ),
        db
          .select({
            machineId: alarms.machineId,
            code: alarms.code,
            severity: alarms.severity
          })
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
          .from(plants)
          .where(
            and(
              eq(plants.tenantId, user.tenantId),
              inArray(plants.id, user.plantIds)
            )
          )
      ]);

      const alarmMap = new Map<string, Array<{ code: string; severity: string }>>();
      for (const a of activeAlarmRows) {
        const list = alarmMap.get(a.machineId) ?? [];
        list.push({ code: a.code, severity: a.severity });
        alarmMap.set(a.machineId, list);
      }

      return NextResponse.json({
        plants: plantRows,
        machines: machineRows.map((m) => ({
          ...m,
          activeAlarms: alarmMap.get(m.id) ?? []
        }))
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
