import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  assets,
  authorize,
  AuthorizationError,
  dashboards,
  dashboardShares,
  DashboardSpecSchema,
  eq,
  inArray,
  isDashboardSharedWithUser,
  machineStatus,
  querySemanticMetric,
  TimeRangeSchema
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const EvaluateDataSchema = z.object({
  range: TimeRangeSchema.optional(),
  plantId: z.string().optional(),
  lineId: z.string().optional(),
  specOverride: DashboardSpecSchema.optional()
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "dashboard:read", { tenantId: user.tenantId });

    const body = EvaluateDataSchema.parse(await req.json().catch(() => ({})));

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
        return problemResponse(403, "Forbidden", "Dashboard is not shared with your account.");
      }

      const activeSpec = body.specOverride
        ? DashboardSpecSchema.parse(body.specOverride)
        : DashboardSpecSchema.parse(dash.spec);

      const widgetData: Record<
        string,
        {
          widgetId: string;
          locked: boolean;
          lockReason?: string;
          metricResult?: unknown;
          statusGrid?: Array<{
            id: string;
            name: string;
            plantId: string;
            status: string;
            machineType: string;
          }>;
          content?: string;
        }
      > = {};

      for (const widget of activeSpec.widgets) {
        if (widget.type === "text") {
          widgetData[widget.id] = {
            widgetId: widget.id,
            locked: false,
            content: widget.content ?? widget.description ?? ""
          };
          continue;
        }

        const effectivePlantId =
          body.plantId ?? widget.filters?.plantId ?? activeSpec.filters?.plantId;
        const effectiveLineId =
          body.lineId ?? widget.filters?.lineId ?? activeSpec.filters?.lineId;

        if (widget.type === "status_grid") {
          try {
            authorize(user, "machine:read", {
              tenantId: user.tenantId,
              plantId: effectivePlantId
            });
            const targetPlants = effectivePlantId
              ? [effectivePlantId]
              : user.plantIds;
            const rows = await db
              .select({
                id: assets.id,
                name: assets.name,
                plantId: assets.plantId,
                lineId: assets.parentId,
                machineType: assets.machineType,
                status: machineStatus.status
              })
              .from(assets)
              .leftJoin(machineStatus, eq(machineStatus.machineId, assets.id))
              .where(
                and(
                  eq(assets.tenantId, user.tenantId),
                  eq(assets.type, "machine"),
                  inArray(assets.plantId, targetPlants)
                )
              )
              .limit(widget.limit ?? 16);

            const filtered = effectiveLineId
              ? rows.filter((r) => r.lineId === effectiveLineId)
              : rows;

            widgetData[widget.id] = {
              widgetId: widget.id,
              locked: false,
              statusGrid: filtered.map((r) => ({
                id: r.id,
                name: r.name,
                plantId: r.plantId,
                machineType: r.machineType,
                status: r.status ?? "offline"
              }))
            };
          } catch (err) {
            widgetData[widget.id] = {
              widgetId: widget.id,
              locked: true,
              lockReason:
                err instanceof AuthorizationError
                  ? err.message
                  : "Machine status access restricted."
            };
          }
          continue;
        }

        if (!widget.metric) {
          widgetData[widget.id] = {
            widgetId: widget.id,
            locked: true,
            lockReason: "No metric configured for widget."
          };
          continue;
        }

        try {
          // Server-side re-verification of metric permission and plant scope per widget
          const metricResult = await querySemanticMetric(db, user, {
            metric: widget.metric,
            groupBy: widget.groupBy,
            range: body.range ?? widget.range ?? activeSpec.filters?.range ?? "7d",
            filters: {
              ...(effectivePlantId ? { plantId: effectivePlantId } : {}),
              ...(effectiveLineId ? { lineId: effectiveLineId } : {}),
              ...(widget.filters?.machineId ? { machineId: widget.filters.machineId } : {}),
              ...(widget.filters?.shift ? { shift: widget.filters.shift } : {})
            },
            sort: widget.sort ?? "desc",
            limit: widget.limit ?? 12,
            compareTo: widget.compareTo
          });

          widgetData[widget.id] = {
            widgetId: widget.id,
            locked: false,
            metricResult
          };
        } catch (err) {
          widgetData[widget.id] = {
            widgetId: widget.id,
            locked: true,
            lockReason:
              err instanceof AuthorizationError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : "Restricted metric"
          };
        }
      }

      return NextResponse.json({ widgetData });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
