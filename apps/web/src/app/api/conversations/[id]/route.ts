import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  asc,
  authorize,
  conversations,
  eq,
  messages,
  pendingActions,
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const PatchConversationSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  createShareLink: z.boolean().optional()
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "docs:read", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const convRows = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, params.id),
            eq(conversations.tenantId, user.tenantId),
            eq(conversations.userId, user.userId)
          )
        )
        .limit(1);

      if (!convRows[0]) {
        return problemResponse(404, "Not Found", "Conversation not found.");
      }

      const msgRows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, convRows[0].id),
            eq(messages.tenantId, user.tenantId)
          )
        )
        .orderBy(asc(messages.createdAt));

      const pendingRows = await db
        .select()
        .from(pendingActions)
        .where(
          and(
            eq(pendingActions.conversationId, convRows[0].id),
            eq(pendingActions.tenantId, user.tenantId)
          )
        );

      const pendingMap = new Map(pendingRows.map((p) => [p.id, p]));

      return NextResponse.json({
        conversation: convRows[0],
        messages: msgRows.map((m) => ({
          ...m,
          pendingAction: m.pendingActionId ? pendingMap.get(m.pendingActionId) ?? null : null
        }))
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "docs:read", { tenantId: user.tenantId });

    const body = PatchConversationSchema.parse(await req.json());

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const existing = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, params.id),
            eq(conversations.tenantId, user.tenantId),
            eq(conversations.userId, user.userId)
          )
        )
        .limit(1);

      if (!existing[0]) {
        return problemResponse(404, "Not Found", "Conversation not found.");
      }

      const updates: Partial<typeof conversations.$inferInsert> = {
        updatedAt: new Date()
      };
      if (body.title) updates.title = body.title.trim();
      if (body.createShareLink) {
        updates.shareToken =
          existing[0].shareToken ?? `shr-${crypto.randomUUID().slice(0, 12)}`;
      }

      await db
        .update(conversations)
        .set(updates)
        .where(eq(conversations.id, existing[0].id));

      return NextResponse.json({
        conversation: { ...existing[0], ...updates }
      });
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
    authorize(user, "docs:read", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      await db
        .delete(conversations)
        .where(
          and(
            eq(conversations.id, params.id),
            eq(conversations.tenantId, user.tenantId),
            eq(conversations.userId, user.userId)
          )
        );

      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
