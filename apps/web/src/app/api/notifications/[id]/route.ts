import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  authorize,
  eq,
  isNull,
  notifications,
  or,
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const PatchOneSchema = z.object({
  read: z.boolean().optional().default(true)
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
    authorize(user, "notification:read", { tenantId: user.tenantId });

    const body = PatchOneSchema.parse(await req.json().catch(() => ({})));
    const now = new Date();

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.id, params.id),
            eq(notifications.tenantId, user.tenantId),
            or(isNull(notifications.userId), eq(notifications.userId, user.userId))
          )
        )
        .limit(1);

      if (!rows[0]) {
        return problemResponse(404, "Not Found", "Notification not found.");
      }

      await db
        .update(notifications)
        .set({
          read: body.read,
          readAt: body.read ? now : null
        })
        .where(eq(notifications.id, rows[0].id));

      return NextResponse.json({
        ok: true,
        notification: { ...rows[0], read: body.read, readAt: body.read ? now : null }
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
