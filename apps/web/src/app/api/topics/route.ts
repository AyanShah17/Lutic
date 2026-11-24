import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorize,
  desc,
  eq,
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

const CreateTopicSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(400).optional().default("")
});

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "notification:read", { tenantId: user.tenantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [topicRows, subRows] = await Promise.all([
        db
          .select()
          .from(topics)
          .where(eq(topics.tenantId, user.tenantId))
          .orderBy(desc(topics.createdAt)),
        db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.tenantId, user.tenantId))
      ]);

      return NextResponse.json({
        topics: topicRows.map((t) => ({
          ...t,
          subscriptions: subRows.filter((s) => s.topicId === t.id)
        })),
        subscriptions: subRows
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
    authorize(user, "notification:write", { tenantId: user.tenantId });

    const body = CreateTopicSchema.parse(await req.json());
    const id = `topic-${crypto.randomUUID().slice(0, 10)}`;
    const row = {
      id,
      tenantId: user.tenantId,
      name: body.name.trim(),
      description: body.description,
      createdAt: new Date()
    };

    return await withWebTenantDb(user.tenantId, async (db) => {
      await db.insert(topics).values(row);

      return NextResponse.json(
        { id, topicId: id, topic: { ...row, subscriptions: [] } },
        { status: 201 }
      );
    });
  } catch (err) {
    return handleApiError(err);
  }
}
