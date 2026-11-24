import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  authorize,
  eq,
  publishToTopic,
  topics
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const PublishSchema = z.object({
  subject: z.string().max(180).optional(),
  title: z.string().max(180).optional(),
  message: z.string().max(4000).optional(),
  body: z.string().max(4000).optional(),
  severity: z.enum(["info", "warning", "high", "critical"]).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
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

      const body = PublishSchema.parse(await req.json());
      const res = await publishToTopic(
        db,
        user.tenantId,
        params.id,
        body
      );

      if (!res.ok && Object.values(res.deliveries).every((count) => count === 0)) {
        return problemResponse(501, "Topic delivery unavailable", res.deliveryFailures[0]!.reason);
      }
      return NextResponse.json(res);
    });
  } catch (err) {
    return handleApiError(err);
  }
}
