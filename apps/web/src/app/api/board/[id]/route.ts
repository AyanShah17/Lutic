import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, auditLog, authorize, boardIssues, eq } from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";
import { BOARD_CATEGORIES, BOARD_PRIORITIES, BOARD_STATUSES } from "@/lib/board-constants";

const UpdateIssueSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().max(4000).optional(),
  status: z.enum(BOARD_STATUSES).optional(),
  priority: z.enum(BOARD_PRIORITIES).optional(),
  category: z.enum(BOARD_CATEGORIES).optional(),
  plantId: z.string().trim().min(1).nullable().optional(),
  assigneeName: z.string().trim().max(120).optional(),
  labels: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
  sourceRef: z.string().trim().max(120).optional(),
  dueDate: z.string().trim().max(32).optional()
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
    authorize(user, "workorder:write", { tenantId: user.tenantId });

    const body = UpdateIssueSchema.parse(await req.json());
    const { id } = await context.params;

    return await withWebTenantDb(user.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(boardIssues)
        .where(and(eq(boardIssues.id, id), eq(boardIssues.tenantId, user.tenantId)))
        .limit(1);

      const existing = rows[0];
      if (!existing) {
        return problemResponse(404, "Not Found", "Board issue not found.");
      }

      const targetPlantId = body.plantId !== undefined ? body.plantId : existing.plantId;
      authorize(user, "workorder:write", {
        tenantId: user.tenantId,
        plantId: existing.plantId ?? undefined
      });
      if (targetPlantId) {
        authorize(user, "workorder:write", {
          tenantId: user.tenantId,
          plantId: targetPlantId
        });
      }

      const [updated] = await db
        .update(boardIssues)
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(body.plantId !== undefined ? { plantId: body.plantId } : {}),
          ...(body.assigneeName !== undefined ? { assigneeName: body.assigneeName } : {}),
          ...(body.labels !== undefined ? { labels: body.labels } : {}),
          ...(body.sourceRef !== undefined ? { sourceRef: body.sourceRef } : {}),
          ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
          updatedAt: new Date()
        })
        .where(and(eq(boardIssues.id, id), eq(boardIssues.tenantId, user.tenantId)))
        .returning();

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        conversationId: null,
        action: "board_issue_update",
        toolName: "board.update_issue",
        args: { id, identifier: existing.identifier, changes: body },
        resultHash: "",
        status: "allowed",
        reason: `Updated ${existing.identifier}`,
        latencyMs: 1
      });

      return NextResponse.json({ issue: updated });
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
    authorize(user, "workorder:write", { tenantId: user.tenantId });

    const { id } = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(boardIssues)
        .where(and(eq(boardIssues.id, id), eq(boardIssues.tenantId, user.tenantId)))
        .limit(1);

      const existing = rows[0];
      if (!existing) {
        return problemResponse(404, "Not Found", "Board issue not found.");
      }
      authorize(user, "workorder:write", {
        tenantId: user.tenantId,
        plantId: existing.plantId ?? undefined
      });

      await db
        .delete(boardIssues)
        .where(and(eq(boardIssues.id, id), eq(boardIssues.tenantId, user.tenantId)));

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        conversationId: null,
        action: "board_issue_delete",
        toolName: "board.delete_issue",
        args: { id, identifier: existing.identifier },
        resultHash: "",
        status: "allowed",
        reason: `Deleted ${existing.identifier}`,
        latencyMs: 1
      });

      return NextResponse.json({ deleted: true, id });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
