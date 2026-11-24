import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  alertRules,
  and,
  assets,
  authorize,
  desc,
  eq,
  inArray,
  isNull,
  or,
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { serializeRule } from "@/lib/serializers";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

function normalizeOperator(
  op?: string
): "gt" | "gte" | "lt" | "lte" | "eq" {
  if (op === "gte" || op === ">=") return "gte";
  if (op === "lt" || op === "<") return "lt";
  if (op === "lte" || op === "<=") return "lte";
  if (op === "eq" || op === "==" || op === "=") return "eq";
  return "gt";
}

const CreateRuleSchema = z.object({
  name: z.string().min(2).max(160),
  machineId: z.string().nullable().optional(),
  plantId: z.string().nullable().optional(),
  metric: z.string().min(1).optional(),
  metricTag: z.string().min(1).optional(),
  operator: z.string().optional().default("gt"),
  threshold: z.coerce.number(),
  severity: z
    .enum(["critical", "high", "medium", "low"])
    .optional()
    .default("high"),
  evaluationWindowMin: z.coerce.number().int().min(1).max(1440).optional().default(5),
  notifyTopicId: z.string().nullable().optional(),
  workflowId: z.string().nullable().optional(),
  enabled: z.boolean().optional().default(true)
});

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "alert:read", { tenantId: user.tenantId });

    const plantScopeCond =
      user.plantIds.length > 0
        ? or(isNull(alertRules.plantId), inArray(alertRules.plantId, user.plantIds))
        : isNull(alertRules.plantId);

    return await withWebTenantDb(user.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(alertRules)
        .where(and(eq(alertRules.tenantId, user.tenantId), plantScopeCond!))
        .orderBy(desc(alertRules.createdAt));

      return NextResponse.json({
        rules: rows.map(serializeRule)
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

    const body = CreateRuleSchema.parse(await req.json());
    const metricTag = (body.metricTag ?? body.metric ?? "").trim();
    if (!metricTag) {
      return problemResponse(
        400,
        "Validation Error",
        "metric or metricTag is required."
      );
    }

    let plantId = body.plantId ?? null;
    return await withWebTenantDb(user.tenantId, async (db) => {
      if (body.machineId) {
        const mRows = await db
          .select({ id: assets.id, plantId: assets.plantId })
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

      const id = `ar-${crypto.randomUUID().slice(0, 10)}`;
      const now = new Date();
      const row = {
        id,
        tenantId: user.tenantId,
        plantId,
        machineId: body.machineId ?? null,
        name: body.name.trim(),
        metricTag,
        operator: normalizeOperator(body.operator),
        threshold: body.threshold,
        severity: body.severity,
        evaluationWindowMin: body.evaluationWindowMin,
        state: "OK" as const,
        notifyTopicId: body.notifyTopicId ?? null,
        workflowId: body.workflowId ?? null,
        enabled: body.enabled,
        lastEvaluatedAt: null,
        createdAt: now,
        updatedAt: now
      };

      await db.insert(alertRules).values(row);

      const serialized = serializeRule(row);
      return NextResponse.json(
        { id, ruleId: id, rule: serialized },
        { status: 201 }
      );
    });
  } catch (err) {
    return handleApiError(err);
  }
}
