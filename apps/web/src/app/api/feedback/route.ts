import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, authorize, eq, feedback, messages } from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const FeedbackSchema = z.object({
  messageId: z.string().min(1),
  rating: z.enum(["up", "down"]),
  outcome: z.enum(["fixed_it", "not_helpful", "wrong"]).nullable().optional(),
  comment: z.string().max(1000).optional().default("")
});

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "docs:read", { tenantId: user.tenantId });

    const body = FeedbackSchema.parse(await req.json());

    return await withWebTenantDb(user.tenantId, async (db) => {
      const msgRows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(eq(messages.id, body.messageId), eq(messages.tenantId, user.tenantId))
        )
        .limit(1);

      if (!msgRows[0]) {
        return problemResponse(404, "Not Found", "Message not found.");
      }

      const row = {
        id: `fb-${crypto.randomUUID().slice(0, 10)}`,
        tenantId: user.tenantId,
        messageId: body.messageId,
        userId: user.userId,
        rating: body.rating,
        outcome: body.outcome ?? null,
        comment: body.comment.trim()
      };

      await db.insert(feedback).values(row);
      return NextResponse.json({ feedback: row }, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
