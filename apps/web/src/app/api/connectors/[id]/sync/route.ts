import { NextResponse } from "next/server";
import {
  and,
  authorize,
  connectorConnections,
  eq,
  syncConnectorConnection
} from "@lutic/core";
import { defaultMcpRegistry } from "@lutic/connectors";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { enforceApiQuota } from "@/lib/quota";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

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
      const quotaErr = await enforceApiQuota(req, db, user, "api");
      if (quotaErr) return quotaErr;

      const rows = await db
        .select({ id: connectorConnections.id })
        .from(connectorConnections)
        .where(
          and(
            eq(connectorConnections.id, params.id),
            eq(connectorConnections.tenantId, user.tenantId)
          )
        )
        .limit(1);

      if (!rows[0]) {
        return problemResponse(404, "Not Found", "Connector not found.");
      }

      const result = await syncConnectorConnection(
        db,
        user.tenantId,
        params.id,
        (kind) => defaultMcpRegistry.discoverMcpTools(kind)
      );
      if (!result.ok) {
        return problemResponse(result.supported === false ? 501 : 422, "Connector sync unavailable", result.message);
      }
      return NextResponse.json(result);
    });
  } catch (err) {
    return handleApiError(err);
  }
}
