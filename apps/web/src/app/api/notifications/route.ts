import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  authorize,
  desc,
  eq,
  inArray,
  isNull,
  notifications,
  or,
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const PatchNotificationsSchema = z.object({
  id: z.string().optional(),
  ids: z.array(z.string()).optional(),
  markAll: z.boolean().optional(),
  read: z.boolean().optional().default(true)
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
        .from(notifications)
        .where(
          and(
            eq(notifications.tenantId, user.tenantId),
            or(
              isNull(notifications.userId),
              eq(notifications.userId, user.userId)
            )
          )
        )
        .orderBy(desc(notifications.createdAt))
        .limit(60);

      const unreadCount = rows.filter((n) => !n.read).length;

      return NextResponse.json({
        notifications: rows,
        unreadCount
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "notification:read", { tenantId: user.tenantId });

    const body = PatchNotificationsSchema.parse(await req.json());
    const targetIds = [
      ...(body.id ? [body.id] : []),
      ...(body.ids ?? [])
    ];

    const scopeCond = and(
      eq(notifications.tenantId, user.tenantId),
      or(isNull(notifications.userId), eq(notifications.userId, user.userId))
    );

    const now = new Date();
    return await withWebTenantDb(user.tenantId, async (db) => {
      if (body.markAll) {
        await db
          .update(notifications)
          .set({
            read: body.read,
            readAt: body.read ? now : null
          })
          .where(scopeCond!);
      } else if (targetIds.length > 0) {
        await db
          .update(notifications)
          .set({
            read: body.read,
            readAt: body.read ? now : null
          })
          .where(and(scopeCond!, inArray(notifications.id, targetIds)));
      }

      return NextResponse.json({ ok: true, read: body.read });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
