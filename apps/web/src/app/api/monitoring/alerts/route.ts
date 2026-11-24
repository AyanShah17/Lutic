import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  alertEvents,
  and,
  assets,
  authorize,
  desc,
  eq,
  inArray,
  isNull,
  notifications,
  or,
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const CreateAlertSchema = z.object({
  machineId: z.string().nullable().optional(),
  plantId: z.string().nullable().optional(),
  title: z.string().min(2).max(180),
  message: z.string().max(1000).optional().default(""),
  severity: z
    .enum(["critical", "high", "medium", "low"])
    .optional()
    .default("high"),
  metricTag: z.string().optional().default("manual"),
  metricValue: z.number().nullable().optional(),
  threshold: z.number().nullable().optional()
});

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "alert:read", { tenantId: user.tenantId });

    const plantCond =
      user.plantIds.length > 0
        ? or(
            isNull(alertEvents.plantId),
            inArray(alertEvents.plantId, user.plantIds)
          )
        : isNull(alertEvents.plantId);

    return await withWebTenantDb(user.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(alertEvents)
        .where(and(eq(alertEvents.tenantId, user.tenantId), plantCond!))
        .orderBy(desc(alertEvents.triggeredAt))
        .limit(60);

      return NextResponse.json({
        alerts: rows,
        events: rows
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "alert:write", { tenantId: user.tenantId });

    const body = CreateAlertSchema.parse(await req.json());
    let plantId = body.plantId ?? null;
    return await withWebTenantDb(user.tenantId, async (db) => {
      if (body.machineId) {
        const mRows = await db
          .select({ plantId: assets.plantId })
          .from(assets)
          .where(
            and(eq(assets.id, body.machineId), eq(assets.tenantId, user.tenantId))
          )
          .limit(1);
        if (!mRows[0]) {
          return problemResponse(404, "Not Found", "Machine not found.");
        }
        plantId = mRows[0].plantId;
      }

      if (plantId && !user.plantIds.includes(plantId)) {
        return problemResponse(
          403,
          "Forbidden",
          `Plant '${plantId}' is outside your authorized scope.`
        );
      }

      const id = `ae-${crypto.randomUUID().slice(0, 12)}`;
      const now = new Date();
      const row = {
        id,
        tenantId: user.tenantId,
        ruleId: null,
        plantId,
        machineId: body.machineId ?? null,
        status: "ALARM" as const,
        severity: body.severity,
        title: body.title.trim(),
        message: body.message || body.title,
        metricTag: body.metricTag,
        metricValue: body.metricValue ?? null,
        threshold: body.threshold ?? null,
        triggeredAt: now,
        acknowledgedBy: null,
        acknowledgedAt: null,
        resolvedBy: null,
        resolvedAt: null
      };

      await db.insert(alertEvents).values(row);
      await db.insert(notifications).values({
        id: `notif-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: null,
        topicId: null,
        channel: "alert",
        severity:
          body.severity === "critical"
            ? "critical"
            : body.severity === "high"
              ? "high"
              : "warning",
        title: `ALERT: ${row.title}`,
        body: row.message,
        metadata: { alertEventId: id, machineId: row.machineId },
        read: false,
        createdAt: now
      });

      return NextResponse.json(
        { id, alertId: id, alert: row },
        { status: 201 }
      );
    });
  } catch (err) {
    return handleApiError(err);
  }
}
