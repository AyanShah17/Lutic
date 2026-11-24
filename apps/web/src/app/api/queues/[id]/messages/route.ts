import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  authorize,
  desc,
  enqueueQueueMessage,
  eq,
  queueMessages,
  queues,
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const EnqueueSchema = z.object({
  body: z.record(z.string(), z.unknown()).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
  delaySeconds: z.coerce.number().int().min(0).max(900).optional()
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "queue:read", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const qRows = await db
        .select({ id: queues.id })
        .from(queues)
        .where(
          and(eq(queues.id, params.id), eq(queues.tenantId, user.tenantId))
        )
        .limit(1);

      if (!qRows[0]) {
        return problemResponse(404, "Not Found", "Queue not found.");
      }

      const msgs = await db
        .select()
        .from(queueMessages)
        .where(
          and(
            eq(queueMessages.queueId, params.id),
            eq(queueMessages.tenantId, user.tenantId)
          )
        )
        .orderBy(desc(queueMessages.enqueuedAt))
        .limit(50);

      return NextResponse.json({
        messages: msgs.map((m) => ({ ...m, messageId: m.id }))
      });
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
    authorize(user, "queue:write", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const qRows = await db
        .select({ id: queues.id })
        .from(queues)
        .where(
          and(eq(queues.id, params.id), eq(queues.tenantId, user.tenantId))
        )
        .limit(1);

      if (!qRows[0]) {
        return problemResponse(404, "Not Found", "Queue not found.");
      }

      const parsed = EnqueueSchema.parse(await req.json());
      const created = await enqueueQueueMessage(
        db,
        user.tenantId,
        params.id,
        parsed
      );

      return NextResponse.json(
        { id: created.id, messageId: created.id, message: created },
        { status: 201 }
      );
    });
  } catch (err) {
    return handleApiError(err);
  }
}
