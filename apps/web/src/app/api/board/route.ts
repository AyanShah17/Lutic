import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  auditLog,
  authorize,
  boardIssues,
  desc,
  eq,
  plants
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { enforceApiQuota } from "@/lib/quota";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";
import { BOARD_CATEGORIES, BOARD_PRIORITIES, BOARD_STATUSES } from "@/lib/board-constants";

const CreateIssueSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().max(4000).optional().default(""),
  status: z.enum(BOARD_STATUSES).optional().default("todo"),
  priority: z.enum(BOARD_PRIORITIES).optional().default("medium"),
  category: z.enum(BOARD_CATEGORIES).optional().default("operations"),
  plantId: z.string().trim().min(1).nullable().optional(),
  assigneeName: z.string().trim().max(120).optional().default(""),
  labels: z.array(z.string().trim().min(1).max(32)).max(12).optional().default([]),
  sourceRef: z.string().trim().max(120).optional().default(""),
  dueDate: z.string().trim().max(32).optional().default("")
});

function nextIdentifier(existing: Array<{ identifier: string }>): string {
  let maxNum = 100;
  for (const row of existing) {
    const match = /^LUT-(\d+)$/.exec(row.identifier);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  return `LUT-${maxNum + 1}`;
}

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "workorder:read", { tenantId: user.tenantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [rows, plantRows] = await Promise.all([
        db
          .select()
          .from(boardIssues)
          .where(eq(boardIssues.tenantId, user.tenantId))
          .orderBy(desc(boardIssues.updatedAt)),
        db
          .select({ id: plants.id, name: plants.name, code: plants.code })
          .from(plants)
          .where(eq(plants.tenantId, user.tenantId))
      ]);

      const visibleIssues =
        user.role === "admin"
          ? rows
          : rows.filter((issue) => !issue.plantId || user.plantIds.includes(issue.plantId));
      const visiblePlants =
        user.role === "admin"
          ? plantRows
          : plantRows.filter((p) => user.plantIds.includes(p.id));

      return NextResponse.json({
        issues: visibleIssues,
        plants: visiblePlants
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

    const body = CreateIssueSchema.parse(await req.json());
    authorize(user, "workorder:write", {
      tenantId: user.tenantId,
      plantId: body.plantId ?? undefined
    });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const quotaError = await enforceApiQuota(req, db, user, "api");
      if (quotaError) return quotaError;
      const existing = await db
        .select({ identifier: boardIssues.identifier })
        .from(boardIssues)
        .where(eq(boardIssues.tenantId, user.tenantId));

      const identifier = nextIdentifier(existing);
      const id = `brd-${crypto.randomUUID().slice(0, 10)}`;
      const now = new Date();

      const [created] = await db
        .insert(boardIssues)
        .values({
          id,
          tenantId: user.tenantId,
          plantId: body.plantId ?? null,
          identifier,
          title: body.title,
          description: body.description,
          status: body.status,
          priority: body.priority,
          category: body.category,
          assigneeName: body.assigneeName,
          labels: body.labels,
          sourceRef: body.sourceRef,
          dueDate: body.dueDate,
          createdBy: user.userId,
          createdAt: now,
          updatedAt: now
        })
        .returning();

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        conversationId: null,
        action: "board_issue_create",
        toolName: "board.create_issue",
        args: { id, identifier, status: body.status, priority: body.priority },
        resultHash: "",
        status: "allowed",
        reason: `Created ${identifier}`,
        latencyMs: 1
      });

      return NextResponse.json({ issue: created }, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
