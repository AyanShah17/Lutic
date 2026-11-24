import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  authorize,
  connectorConnections,
  connectorTriggers,
  encryptCredentials,
  eq,
  isDemoMode,
  listConnectorSyncLogs,
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";
import { sanitizeConnector } from "@/lib/serializers";

const PatchConnectorSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  endpointUrl: z.string().optional(),
  status: z
    .enum(["connected", "degraded", "disconnected", "error"])
    .optional(),
  credentials: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional()
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
      const [rows, triggers, logs] = await Promise.all([
        db
          .select()
          .from(connectorConnections)
          .where(
            and(
              eq(connectorConnections.id, params.id),
              eq(connectorConnections.tenantId, user.tenantId)
            )
          )
          .limit(1),
        db
          .select()
          .from(connectorTriggers)
          .where(
            and(
              eq(connectorTriggers.connectionId, params.id),
              eq(connectorTriggers.tenantId, user.tenantId)
            )
          ),
        listConnectorSyncLogs(db, user.tenantId, params.id, 20)
      ]);

      const conn = rows[0];
      if (!conn) {
        return problemResponse(404, "Not Found", "Connector not found.");
      }

      return NextResponse.json({
        connector: sanitizeConnector(conn),
        triggers,
        logs
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
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
      const rows = await db
        .select()
        .from(connectorConnections)
        .where(
          and(
            eq(connectorConnections.id, params.id),
            eq(connectorConnections.tenantId, user.tenantId)
          )
        )
        .limit(1);

      const existing = rows[0];
      if (!existing) {
        return problemResponse(404, "Not Found", "Connector not found.");
      }

      const body = PatchConnectorSchema.parse(await req.json());
      const demo = isDemoMode();
      if (!demo && body.status && body.status !== "disconnected") {
        return problemResponse(400, "Invalid connector status", "Use the connector health check to update connection status.");
      }
      const resetDiscovery = !demo && (
        body.status === "disconnected" || body.endpointUrl !== undefined ||
        body.credentials !== undefined || body.config !== undefined
      );
      await db
        .update(connectorConnections)
        .set({
          name: body.name?.trim() ?? existing.name,
          endpointUrl: body.endpointUrl ?? existing.endpointUrl,
          status: resetDiscovery ? "disconnected" : body.status ?? existing.status,
          ...(resetDiscovery ? { discoveredTools: [], lastSyncAt: null, lastError: null } : {}),
          encryptedCredentials: body.credentials
            ? encryptCredentials(body.credentials)
            : existing.encryptedCredentials,
          config: body.config
            ? { ...(existing.config ?? {}), ...body.config }
            : existing.config,
          updatedAt: new Date()
        })
        .where(eq(connectorConnections.id, existing.id));

      const [updated] = await db
        .select()
        .from(connectorConnections)
        .where(eq(connectorConnections.id, existing.id))
        .limit(1);

      return NextResponse.json({ connector: sanitizeConnector(updated!) });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
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
      const existing = await db
        .select({ id: connectorConnections.id })
        .from(connectorConnections)
        .where(
          and(
            eq(connectorConnections.id, params.id),
            eq(connectorConnections.tenantId, user.tenantId)
          )
        )
        .limit(1);

      if (!existing[0]) {
        return problemResponse(404, "Not Found", "Connector not found.");
      }

      await db
        .delete(connectorConnections)
        .where(
          and(
            eq(connectorConnections.id, params.id),
            eq(connectorConnections.tenantId, user.tenantId)
          )
        );

      return NextResponse.json({ ok: true, id: params.id });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
