import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  authorize,
  eq,
  listQueueSummaries,
  queues,
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const CreateQueueSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(400).optional().default(""),
  visibilityTimeoutSec: z.coerce.number().int().min(1).max(3600).optional().default(30),
  maxReceiveCount: z.coerce.number().int().min(1).max(100).optional(),
  maxRetries: z.coerce.number().int().min(1).max(100).optional(),
  deadLetterQueueId: z.string().nullable().optional()
});

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "queue:read", { tenantId: user.tenantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const summaries = await listQueueSummaries(db, user.tenantId);
      return NextResponse.json({ queues: summaries });
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
    authorize(user, "queue:write", { tenantId: user.tenantId });

    const body = CreateQueueSchema.parse(await req.json());
    const id = `queue-${crypto.randomUUID().slice(0, 10)}`;
    const row = {
      id,
      tenantId: user.tenantId,
      name: body.name.trim(),
      description: body.description,
      visibilityTimeoutSec: body.visibilityTimeoutSec,
      maxReceiveCount: body.maxReceiveCount ?? body.maxRetries ?? 3,
      deadLetterQueueId: body.deadLetterQueueId ?? null,
      createdAt: new Date()
    };

    return await withWebTenantDb(user.tenantId, async (db) => {
      if (row.deadLetterQueueId) {
        const [deadLetterQueue] = await db.select({ id: queues.id }).from(queues).where(and(
          eq(queues.id, row.deadLetterQueueId), eq(queues.tenantId, user.tenantId)
        )).limit(1);
        if (!deadLetterQueue) return problemResponse(404, "Not Found", "Dead-letter queue not found.");
      }
      await db.insert(queues).values(row);

      return NextResponse.json(
        {
          id,
          queueId: id,
          queue: {
            ...row,
            readyCount: 0,
            inFlightCount: 0,
            deadLetterCount: 0,
            ackedCount: 0
          }
        },
        { status: 201 }
      );
    });
  } catch (err) {
    return handleApiError(err);
  }
}
