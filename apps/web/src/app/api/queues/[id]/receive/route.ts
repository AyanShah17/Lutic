import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  authorize,
  eq,
  pollQueueMessages,
  queues,
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const ReceiveSchema = z.object({
  maxMessages: z.coerce.number().int().min(1).max(20).optional().default(5),
  visibilityTimeoutSec: z.coerce.number().int().min(1).max(3600).optional()
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

      let rawBody: unknown = {};
      try {
        rawBody = await req.json();
      } catch {
        rawBody = {};
      }
      const body = ReceiveSchema.parse(rawBody);
      const messages = await pollQueueMessages(
        db,
        user.tenantId,
        params.id,
        body
      );

      return NextResponse.json({ messages });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
