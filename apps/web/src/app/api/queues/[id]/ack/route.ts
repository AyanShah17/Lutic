import { NextResponse } from "next/server";
import { z } from "zod";
import {
  acknowledgeQueueMessage,
  and,
  authorize,
  eq,
  queues,
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const AckSchema = z.object({
  messageId: z.string().optional(),
  receiptHandle: z.string().optional()
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

      const body = AckSchema.parse(await req.json());
      if (!body.messageId && !body.receiptHandle) {
        return problemResponse(
          400,
          "Validation Error",
          "messageId or receiptHandle is required."
        );
      }

      const res = await acknowledgeQueueMessage(
        db,
        user.tenantId,
        params.id,
        body
      );

      return NextResponse.json(res);
    });
  } catch (err) {
    return handleApiError(err);
  }
}
