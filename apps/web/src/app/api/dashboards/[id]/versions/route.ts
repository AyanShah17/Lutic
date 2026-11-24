import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  authorize,
  dashboards,
  dashboardShares,
  DashboardSpecSchema,
  dashboardVersions,
  desc,
  eq,
  isDashboardSharedWithUser,
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb, pruneDashboardVersions } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const RestoreVersionSchema = z.object({
  version: z.number().int().min(1)
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

      if (
        !isDashboardSharedWithUser(user, {
          tenantId: dash.tenantId,
          ownerId: dash.ownerId,
          plantScope: dash.plantScope,
          shares: shares.map((s) => ({
            shareType: s.shareType as "role" | "plant",
            targetId: s.targetId
          }))
        })
      ) {
        return problemResponse(403, "Forbidden", "You do not have access to this dashboard.");
      }

      const rows = await db
        .select()
        .from(dashboardVersions)
        .where(
          and(
            eq(dashboardVersions.dashboardId, params.id),
            eq(dashboardVersions.tenantId, user.tenantId)
          )
        )
        .orderBy(desc(dashboardVersions.version))
        .limit(5);

      return NextResponse.json({ versions: rows });
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
    authorize(user, "dashboard:write", { tenantId: user.tenantId });

    const { version } = RestoreVersionSchema.parse(await req.json());

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const [dashRows, targetRows] = await Promise.all([
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
          .from(dashboardVersions)
          .where(
            and(
              eq(dashboardVersions.dashboardId, params.id),
              eq(dashboardVersions.tenantId, user.tenantId),
              eq(dashboardVersions.version, version)
            )
          )
          .limit(1)
      ]);

      const dash = dashRows[0];
      const target = targetRows[0];
      if (!dash || !target) {
        return problemResponse(404, "Not Found", "Dashboard or target version not found.");
      }
      if (user.role !== "admin" && dash.ownerId !== user.userId) {
        return problemResponse(403, "Forbidden", "Only the owner or admin can restore versions.");
      }

      const nextVersion = dash.currentVersion + 1;
      const rawRestored = DashboardSpecSchema.parse({
        ...target.spec,
        id: dash.id,
        version: nextVersion
      });
      const scopedPlants =
        user.role === "admin"
          ? rawRestored.plantScope.length > 0
            ? rawRestored.plantScope
            : user.plantIds
          : rawRestored.plantScope.filter((p) => user.plantIds.includes(p));
      const restoredSpec = DashboardSpecSchema.parse({
        ...rawRestored,
        plantScope: scopedPlants.length > 0 ? scopedPlants : user.plantIds
      });

      await db
        .update(dashboards)
        .set({
          title: restoredSpec.title,
          description: restoredSpec.description,
          plantScope: restoredSpec.plantScope,
          spec: restoredSpec as unknown as Record<string, unknown>,
          currentVersion: nextVersion,
          updatedAt: new Date()
        })
        .where(eq(dashboards.id, dash.id));

      await db.insert(dashboardVersions).values({
        id: `dv-${dash.id}-v${nextVersion}-${crypto.randomUUID().slice(0, 4)}`,
        tenantId: user.tenantId,
        dashboardId: dash.id,
        version: nextVersion,
        spec: restoredSpec as unknown as Record<string, unknown>,
        createdBy: user.userId,
        changeSummary: `Restored from v${version}`
      });

      await pruneDashboardVersions(db, dash.id, user.tenantId, 5);

      return NextResponse.json({ version: nextVersion, spec: restoredSpec });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
