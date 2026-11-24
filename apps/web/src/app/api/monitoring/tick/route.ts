import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  assets,
  authorize,
  can,
  eq,
  executeQueuedWorkflowRun,
  inArray,
  isDemoMode,
  runRuntimeTick
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const TickBodySchema = z.object({
  machineId: z.string().min(1).optional(),
  forceConnectorSync: z.boolean().optional(),
  forceTriggers: z.boolean().optional(),
  telemetryOverrides: z
    .array(
      z.object({
        machineId: z.string().min(1),
        vibration: z.number().optional(),
        temperature: z.number().optional(),
        pressure: z.number().optional(),
        currentSpeed: z.number().optional(),
        status: z.enum(["running", "idle", "fault", "offline"]).optional()
      })
    ).max(100)
    .optional()
});

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "alert:read", { tenantId: user.tenantId });
    if (!can(user, "alert:write") && !can(user, "alert:acknowledge")) {
      return problemResponse(403, "Forbidden", "Insufficient permission to run monitoring tick.");
    }

    let rawBody: unknown = {};
    try {
      rawBody = await req.json();
    } catch {
      rawBody = {};
    }
    const body = TickBodySchema.parse(rawBody);
    if (!isDemoMode() && (body.telemetryOverrides?.length || body.forceConnectorSync || body.forceTriggers)) {
      return problemResponse(400, "Demo controls unavailable", "Telemetry overrides and forced connector events require demo mode.");
    }
    if (body.forceConnectorSync || body.forceTriggers) {
      authorize(user, "connector:write", { tenantId: user.tenantId });
    }

    return await withWebTenantDb(user.tenantId, async (db) => {
      const targetIds = new Set(body.telemetryOverrides?.map((o) => o.machineId));
      if (body.machineId) targetIds.add(body.machineId);
      if (targetIds.size > 0) {
        const foundMachines = await db
          .select({
            id: assets.id,
            tenantId: assets.tenantId,
            plantId: assets.plantId,
            type: assets.type
          })
          .from(assets)
          .where(and(inArray(assets.id, [...targetIds]), eq(assets.tenantId, user.tenantId)));
        const foundMap = new Map(foundMachines.map((m) => [m.id, m]));
        for (const machineId of targetIds) {
          const machine = foundMap.get(machineId);
          if (!machine) {
            return problemResponse(404, "Not Found", `Machine ${machineId} not found.`);
          }
          authorize(user, "alert:read", {
            tenantId: machine.tenantId,
            plantId: machine.plantId
          });
          if (machine.type !== "machine") {
            return problemResponse(404, "Not Found", `Machine ${machineId} not found.`);
          }
        }
      }

      const summary = await runRuntimeTick(db, {
        telemetryOverrides: body.telemetryOverrides,
        forceConnectorSync: body.forceConnectorSync,
        forceTriggers: body.forceTriggers,
        scope: { tenantId: user.tenantId, plantIds: user.plantIds, machineId: body.machineId },
        executeWorkflowRun: can(user, "workflow:execute") ? executeQueuedWorkflowRun : undefined
      });

      return NextResponse.json({ ok: true, summary });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
