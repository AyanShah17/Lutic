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

const CreateSubSchema = z.object({
  topicId: z.string().min(1),
  protocol: z.enum(["in_app", "queue", "workflow", "webhook"]).default("in_app"),
  endpoint: z.string().min(1),
  filterPolicy: z.record(z.string(), z.unknown()).optional().default({})
});

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "notification:read", { tenantId: user.tenantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, user.tenantId));

      return NextResponse.json({ subscriptions: rows });
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

    const body = CreateSubSchema.parse(await req.json());
    return await withWebTenantDb(user.tenantId, async (db) => {
      const topicRows = await db
        .select({ id: topics.id })
        .from(topics)
        .where(
          and(eq(topics.id, body.topicId), eq(topics.tenantId, user.tenantId))
        )
        .limit(1);

      if (!topicRows[0]) {
        return problemResponse(404, "Not Found", "Topic not found.");
      }

      if (!isDemoMode() && body.protocol === "webhook") {
        return problemResponse(
          501,
          "Webhook subscriptions unavailable",
          "Outbound webhook subscriptions require demo mode or an external delivery worker."
        );
      }

      const id = `sub-${crypto.randomUUID().slice(0, 10)}`;
      const row = {
        id,
        tenantId: user.tenantId,
        topicId: body.topicId,
        protocol: body.protocol,
        endpoint: body.endpoint,
        filterPolicy: body.filterPolicy,
        enabled: true,
        createdAt: new Date()
      };

      await db.insert(subscriptions).values(row);
      return NextResponse.json({ id, subscription: row }, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "notification:write", { tenantId: user.tenantId });

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return problemResponse(400, "Validation Error", "id query param required.");
    }

    return await withWebTenantDb(user.tenantId, async (db) => {
      await db
        .delete(subscriptions)
        .where(
          and(eq(subscriptions.id, id), eq(subscriptions.tenantId, user.tenantId))
        );

      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
