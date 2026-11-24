import { NextResponse } from "next/server";
import {
  and,
  authorize,
  eq,
  purgeQueueMessages,
  queues,
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

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

      const res = await purgeQueueMessages(db, user.tenantId, params.id);
      return NextResponse.json(res);
    });
  } catch (err) {
    return handleApiError(err);
  }
}
