import { NextResponse } from "next/server";
import {
  alarms,
  and,
  assets,
  authorize,
  desc,
  eq,
  isNull,
  machineStatus,
  plants,
  workOrders
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { getSessionUser, handleApiError, problemResponse } from "@/lib/auth";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const machineRows = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, params.id),
            eq(assets.tenantId, user.tenantId)
          )
        )
        .limit(1);

      const machine = machineRows[0];
      if (!machine) {
        return problemResponse(404, "Not Found", "Machine not found.");
      }

      authorize(user, "machine:read", {
        tenantId: machine.tenantId,
        plantId: machine.plantId
      });

      const [statusRows, activeAlarms, recentOrders, plantRows] = await Promise.all([
        db
          .select()
          .from(machineStatus)
          .where(eq(machineStatus.machineId, machine.id))
          .limit(1),
        db
          .select()
          .from(alarms)
          .where(
            and(
              eq(alarms.machineId, machine.id),
              eq(alarms.tenantId, user.tenantId),
              isNull(alarms.clearedAt)
            )
          )
          .orderBy(desc(alarms.raisedAt)),
        db
          .select()
          .from(workOrders)
          .where(
            and(
              eq(workOrders.machineId, machine.id),
              eq(workOrders.tenantId, user.tenantId)
            )
          )
          .orderBy(desc(workOrders.openedAt))
          .limit(5),
        db
          .select()
          .from(plants)
          .where(eq(plants.id, machine.plantId))
          .limit(1)
      ]);

      return NextResponse.json({
        machine,
        plant: plantRows[0] ?? null,
        status: statusRows[0] ?? null,
        activeAlarms,
        recentWorkOrders: recentOrders
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
