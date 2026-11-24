import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  authorize,
  eq,
  isDemoMode,
  subscriptions,
  topics
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const SubscribeSchema = z.object({
  protocol: z.enum(["in_app", "queue", "workflow", "webhook"]).optional(),
  targetType: z.enum(["in_app", "queue", "workflow", "webhook"]).optional(),
  endpoint: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
  queueId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  workflowId: z.string().min(1).optional(),
  filterPolicy: z.record(z.string(), z.unknown()).optional().default({})
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "notification:read", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.topicId, params.id),
            eq(subscriptions.tenantId, user.tenantId)
          )
        );

      return NextResponse.json({ subscriptions: rows });
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
    authorize(user, "notification:write", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const topicRows = await db
        .select({ id: topics.id })
        .from(topics)
        .where(
          and(
            eq(topics.id, params.id),
            eq(topics.tenantId, user.tenantId)
          )
        )
        .limit(1);

      if (!topicRows[0]) {
        return problemResponse(404, "Not Found", "Topic not found.");
      }

      const body = SubscribeSchema.parse(await req.json());
      const protocol = body.protocol ?? body.targetType ?? "in_app";
      if (!isDemoMode() && protocol === "webhook") {
        return problemResponse(
          501,
          "Webhook subscriptions unavailable",
          "Outbound webhook subscriptions require demo mode or an external delivery worker."
        );
      }
      const endpoint =
        body.endpoint ??
        body.targetId ??
        body.queueId ??
        body.userId ??
        body.workflowId ??
        "all";

      const id = `sub-${crypto.randomUUID().slice(0, 10)}`;
      const row = {
        id,
        tenantId: user.tenantId,
        topicId: params.id,
        protocol,
        endpoint,
        filterPolicy: body.filterPolicy,
        enabled: true,
        createdAt: new Date()
      };

      await db.insert(subscriptions).values(row);

      return NextResponse.json(
        { id, subscriptionId: id, subscription: row },
        { status: 201 }
      );
    });
  } catch (err) {
    return handleApiError(err);
  }
}
