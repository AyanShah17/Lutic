import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  and,
  auditLog,
  authorize,
  dashboards,
  DashboardShareRequestSchema,
  dashboardShares,
  eq,
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
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
    authorize(user, "dashboard:share", { tenantId: user.tenantId });

    const body = DashboardShareRequestSchema.parse(await req.json());

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const dashRows = await db
        .select()
        .from(dashboards)
        .where(
          and(
            eq(dashboards.id, params.id),
            eq(dashboards.tenantId, user.tenantId)
          )
        )
        .limit(1);

      const dash = dashRows[0];
      if (!dash) return problemResponse(404, "Not Found", "Dashboard not found.");
      if (user.role !== "admin" && dash.ownerId !== user.userId) {
        return problemResponse(403, "Forbidden", "Only owner or admin can share this dashboard.");
      }

      await db
        .delete(dashboardShares)
        .where(
          and(
            eq(dashboardShares.dashboardId, dash.id),
            eq(dashboardShares.tenantId, user.tenantId)
          )
        );

      if (body.shares.length > 0) {
        await db.insert(dashboardShares).values(
          body.shares.map((s) => ({
            id: `ds-${crypto.randomUUID().slice(0, 10)}`,
            tenantId: user.tenantId,
            dashboardId: dash.id,
            shareType: s.shareType,
            targetId: s.targetId
          }))
        );
      }

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "dashboard_share",
        toolName: "dashboard.share",
        args: { dashboardId: dash.id, shares: body.shares },
        resultHash: "",
        status: "allowed",
        reason: "Updated shares",
        latencyMs: 1
      });

      return NextResponse.json({ ok: true, shares: body.shares });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
