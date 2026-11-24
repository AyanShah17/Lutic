import { NextResponse } from "next/server";
import { z } from "zod";
import {
  alertRules,
  and,
  authorize,
  eq,
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";
import { serializeRule } from "@/lib/serializers";

const PatchRuleSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  operator: z.enum(["gt", "gte", "lt", "lte", "eq"]).optional(),
  threshold: z.coerce.number().optional(),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
  enabled: z.boolean().optional(),
  notifyTopicId: z.string().nullable().optional(),
  workflowId: z.string().nullable().optional()
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "alert:write", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const existingRows = await db
        .select()
        .from(alertRules)
        .where(
          and(
            eq(alertRules.id, params.id),
            eq(alertRules.tenantId, user.tenantId)
          )
        )
        .limit(1);

      const existing = existingRows[0];
      if (!existing) {
        return problemResponse(404, "Not Found", "Alert rule not found.");
      }
      if (existing.plantId && !user.plantIds.includes(existing.plantId)) {
        return problemResponse(403, "Forbidden", "Alert rule outside your plant scope.");
      }

      const body = PatchRuleSchema.parse(await req.json());
      await db
        .update(alertRules)
        .set({
          name: body.name?.trim() ?? existing.name,
          operator: body.operator ?? existing.operator,
          threshold: body.threshold ?? existing.threshold,
          severity: body.severity ?? existing.severity,
          enabled: body.enabled ?? existing.enabled,
          notifyTopicId:
            body.notifyTopicId !== undefined
              ? body.notifyTopicId
              : existing.notifyTopicId,
          workflowId:
            body.workflowId !== undefined ? body.workflowId : existing.workflowId,
          updatedAt: new Date()
        })
        .where(eq(alertRules.id, existing.id));

      const [updated] = await db
        .select()
        .from(alertRules)
        .where(eq(alertRules.id, existing.id))
        .limit(1);

      return NextResponse.json({ rule: serializeRule(updated!) });
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
    authorize(user, "alert:write", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const existing = await db
        .select({ id: alertRules.id, plantId: alertRules.plantId })
        .from(alertRules)
        .where(
          and(
            eq(alertRules.id, params.id),
            eq(alertRules.tenantId, user.tenantId)
          )
        )
        .limit(1);

      if (!existing[0]) {
        return problemResponse(404, "Not Found", "Alert rule not found.");
      }
      if (existing[0].plantId && !user.plantIds.includes(existing[0].plantId)) {
        return problemResponse(403, "Forbidden", "Alert rule outside your plant scope.");
      }

      await db
        .delete(alertRules)
        .where(
          and(
            eq(alertRules.id, params.id),
            eq(alertRules.tenantId, user.tenantId)
          )
        );

      return NextResponse.json({ ok: true, id: params.id });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
