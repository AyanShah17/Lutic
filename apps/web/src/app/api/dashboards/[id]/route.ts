import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  auditLog,
  authorize,
  can,
  dashboards,
  dashboardShares,
  DashboardSpecSchema,
  dashboardVersions,
  eq,
  isDashboardSharedWithUser,
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb, pruneDashboardVersions } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const UpdateDashboardSchema = z.object({
  spec: DashboardSpecSchema,
  changeSummary: z.string().max(240).optional().default("Updated dashboard")
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "dashboard:read", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const [dashRows, shares] = await Promise.all([
        db
          .select()
          .from(dashboards)
          .where(
            and(
              eq(dashboards.id, params.id),
              eq(dashboards.tenantId, user.tenantId)
            )
          )
          .limit(1),
        db
          .select()
          .from(dashboardShares)
          .where(
            and(
              eq(dashboardShares.dashboardId, params.id),
              eq(dashboardShares.tenantId, user.tenantId)
            )
          )
      ]);

      const dash = dashRows[0];
      if (!dash) return problemResponse(404, "Not Found", "Dashboard not found.");

      const formattedShares = shares.map((s) => ({
        shareType: s.shareType as "role" | "plant",
        targetId: s.targetId
      }));

      if (
        !isDashboardSharedWithUser(user, {
          tenantId: dash.tenantId,
          ownerId: dash.ownerId,
          plantScope: dash.plantScope,
          shares: formattedShares
        })
      ) {
        return problemResponse(403, "Forbidden", "You do not have access to this dashboard.");
      }

      const canEdit =
        can(user, "dashboard:write", { tenantId: dash.tenantId }) &&
        (user.role === "admin" || dash.ownerId === user.userId);

      return NextResponse.json({
        dashboard: dash,
        shares: formattedShares,
        canEdit
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const existingRows = await db
        .select()
        .from(dashboards)
        .where(
          and(
            eq(dashboards.id, params.id),
            eq(dashboards.tenantId, user.tenantId)
          )
        )
        .limit(1);

      const existing = existingRows[0];
      if (!existing) {
        return problemResponse(404, "Not Found", "Dashboard not found.");
      }

      // Enforce write permission server-side (never rely on UI hiding)
      authorize(user, "dashboard:write", { tenantId: existing.tenantId });
      if (user.role !== "admin" && existing.ownerId !== user.userId) {
        return problemResponse(403, "Forbidden", "Only the owner or an admin can edit this dashboard.");
      }

      const body = UpdateDashboardSchema.parse(await req.json());
      const nextVersion = existing.currentVersion + 1;

      // Enforce plantScope stays within editor's plants
      const safePlantScope =
        body.spec.plantScope.length > 0
          ? body.spec.plantScope.filter((p) => user.plantIds.includes(p))
          : user.plantIds;

      const validatedSpec = DashboardSpecSchema.parse({
        ...body.spec,
        id: existing.id,
        plantScope: safePlantScope,
        version: nextVersion
      });

      await db
        .update(dashboards)
        .set({
          title: validatedSpec.title,
          description: validatedSpec.description,
          plantScope: validatedSpec.plantScope,
          spec: validatedSpec as unknown as Record<string, unknown>,
          currentVersion: nextVersion,
          updatedAt: new Date()
        })
        .where(eq(dashboards.id, existing.id));

      await db.insert(dashboardVersions).values({
        id: `dv-${existing.id}-v${nextVersion}`,
        tenantId: user.tenantId,
        dashboardId: existing.id,
        version: nextVersion,
        spec: validatedSpec as unknown as Record<string, unknown>,
        createdBy: user.userId,
        changeSummary: body.changeSummary
      });

      await pruneDashboardVersions(db, existing.id, user.tenantId, 5);

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "dashboard_update",
        toolName: "dashboard.save_version",
        args: { dashboardId: existing.id, version: nextVersion },
        resultHash: "",
        status: "allowed",
        reason: body.changeSummary,
        latencyMs: 1
      });

      return NextResponse.json({
        version: nextVersion,
        spec: validatedSpec
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
