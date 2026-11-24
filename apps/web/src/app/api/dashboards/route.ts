import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  auditLog,
  authorize,
  dashboards,
  dashboardShares,
  DashboardSpecSchema,
  dashboardVersions,
  desc,
  eq,
  isDashboardSharedWithUser,
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const CreateDashboardBodySchema = z.object({
  title: z.string().min(1).max(140),
  description: z.string().max(500).optional().default(""),
  spec: DashboardSpecSchema.optional(),
  fromTemplateId: z.string().optional()
});

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "dashboard:read", { tenantId: user.tenantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [rows, shares] = await Promise.all([
        db
          .select()
          .from(dashboards)
          .where(eq(dashboards.tenantId, user.tenantId))
          .orderBy(desc(dashboards.updatedAt)),
        db
          .select()
          .from(dashboardShares)
          .where(eq(dashboardShares.tenantId, user.tenantId))
      ]);

      const shareMap = new Map<
        string,
        Array<{ shareType: "role" | "plant"; targetId: string }>
      >();
      for (const s of shares) {
        const list = shareMap.get(s.dashboardId) ?? [];
        list.push({
          shareType: s.shareType as "role" | "plant",
          targetId: s.targetId
        });
        shareMap.set(s.dashboardId, list);
      }

      const visible = rows
        .filter((d) =>
          isDashboardSharedWithUser(user, {
            tenantId: d.tenantId,
            ownerId: d.ownerId,
            plantScope: d.plantScope,
            shares: shareMap.get(d.id) ?? []
          })
        )
        .map((d) => ({
          ...d,
          shares: shareMap.get(d.id) ?? []
        }));

      return NextResponse.json({ dashboards: visible });
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
    authorize(user, "dashboard:write", { tenantId: user.tenantId });

    const body = CreateDashboardBodySchema.parse(await req.json());
    const newId = `dash-${crypto.randomUUID().slice(0, 8)}`;

    let spec = body.spec;
    return await withWebTenantDb(user.tenantId, async (db) => {
      if (!spec && body.fromTemplateId) {
        const [tplRows, tplShares] = await Promise.all([
          db
            .select()
            .from(dashboards)
            .where(
              and(
                eq(dashboards.id, body.fromTemplateId),
                eq(dashboards.tenantId, user.tenantId)
              )
            )
            .limit(1),
          db
            .select()
            .from(dashboardShares)
            .where(
              and(
                eq(dashboardShares.dashboardId, body.fromTemplateId),
                eq(dashboardShares.tenantId, user.tenantId)
              )
            )
        ]);
        const tpl = tplRows[0];
        if (!tpl) {
          return problemResponse(404, "Not Found", "Template dashboard not found.");
        }
        if (
          !isDashboardSharedWithUser(user, {
            tenantId: tpl.tenantId,
            ownerId: tpl.ownerId,
            plantScope: tpl.plantScope,
            shares: tplShares.map((s) => ({
              shareType: s.shareType as "role" | "plant",
              targetId: s.targetId
            }))
          })
        ) {
          return problemResponse(403, "Forbidden", "You do not have access to this template.");
        }
        spec = DashboardSpecSchema.parse({
          ...tpl.spec,
          id: newId,
          title: body.title,
          description: body.description || tpl.description,
          version: 1
        });
      }

      if (!spec) {
        spec = DashboardSpecSchema.parse({
          id: newId,
          title: body.title,
          description: body.description,
          plantScope: user.plantIds,
          filters: { range: "7d" },
          widgets: [
            {
              id: "w-1",
              type: "kpi",
              title: "Plant OEE",
              metric: "oee",
              range: "7d",
              target: 82
            }
          ],
          layout: [{ i: "w-1", x: 0, y: 0, w: 4, h: 3 }],
          version: 1
        });
      } else {
        const scopedPlants =
          user.role === "admin"
            ? spec.plantScope.length > 0
              ? spec.plantScope
              : user.plantIds
            : spec.plantScope.filter((p) => user.plantIds.includes(p));
        spec = DashboardSpecSchema.parse({
          ...spec,
          id: newId,
          title: body.title || spec.title,
          plantScope: scopedPlants.length > 0 ? scopedPlants : user.plantIds,
          version: 1
        });
      }

      await db.insert(dashboards).values({
        id: newId,
        tenantId: user.tenantId,
        ownerId: user.userId,
        title: spec.title,
        description: spec.description,
        plantScope: spec.plantScope,
        spec: spec as unknown as Record<string, unknown>,
        currentVersion: 1,
        isTemplate: false
      });

      await db.insert(dashboardVersions).values({
        id: `dv-${newId}-v1`,
        tenantId: user.tenantId,
        dashboardId: newId,
        version: 1,
        spec: spec as unknown as Record<string, unknown>,
        createdBy: user.userId,
        changeSummary: "Created dashboard"
      });

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "dashboard_create",
        toolName: "dashboard.create",
        args: { dashboardId: newId, title: spec.title },
        resultHash: "",
        status: "allowed",
        reason: "Dashboard created",
        latencyMs: 1
      });

      return NextResponse.json({ dashboardId: newId, spec }, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
