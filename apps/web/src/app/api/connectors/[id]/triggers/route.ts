import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  authorize,
  connectorConnections,
  connectorTriggers,
  eq,
  fireConnectorTrigger,
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const TriggerActionSchema = z.object({
  action: z.enum(["create", "fire"]).optional().default("create"),
  triggerId: z.string().optional(),
  name: z.string().min(2).max(160).optional(),
  eventType: z.string().min(2).max(120).optional(),
  workflowId: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  payload: z.record(z.string(), z.unknown()).optional()
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "connector:read", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const triggers = await db
        .select()
        .from(connectorTriggers)
        .where(
          and(
            eq(connectorTriggers.connectionId, params.id),
            eq(connectorTriggers.tenantId, user.tenantId)
          )
        );

      return NextResponse.json({ triggers });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "connector:write", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const connRows = await db
        .select({ id: connectorConnections.id })
        .from(connectorConnections)
        .where(
          and(
            eq(connectorConnections.id, params.id),
            eq(connectorConnections.tenantId, user.tenantId)
          )
        )
        .limit(1);

      if (!connRows[0]) {
        return problemResponse(404, "Not Found", "Connector not found.");
      }

      const body = TriggerActionSchema.parse(await req.json());
      if (body.action === "fire" && body.triggerId) {
        const fired = await fireConnectorTrigger(
          db,
          user.tenantId,
          body.triggerId,
          body.payload
        );
        return NextResponse.json(fired);
      }

      if (!body.name || !body.eventType) {
        return problemResponse(
          400,
          "Validation Error",
          "name and eventType are required to create a trigger."
        );
      }

      const id = `trig-${crypto.randomUUID().slice(0, 10)}`;
      const row = {
        id,
        tenantId: user.tenantId,
        connectionId: params.id,
        name: body.name.trim(),
        eventType: body.eventType.trim(),
        workflowId: body.workflowId ?? null,
        config: body.config,
        enabled: true,
        lastFiredAt: null,
        createdAt: new Date()
      };

      await db.insert(connectorTriggers).values(row);
      return NextResponse.json({ id, trigger: row }, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
