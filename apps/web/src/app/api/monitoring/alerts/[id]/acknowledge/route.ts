import { NextResponse } from "next/server";
import {
  alertEvents,
  and,
  authorize,
  eq,
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
    authorize(user, "alert:acknowledge", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(alertEvents)
        .where(
          and(
            eq(alertEvents.id, params.id),
            eq(alertEvents.tenantId, user.tenantId)
          )
        )
        .limit(1);

      const existing = rows[0];
      if (!existing) {
        return problemResponse(404, "Not Found", "Alert event not found.");
      }
      if (existing.plantId && !user.plantIds.includes(existing.plantId)) {
        return problemResponse(
          403,
          "Forbidden",
          "Alert belongs to a plant outside your scope."
        );
      }

      const now = new Date();
      await db
        .update(alertEvents)
        .set({
          status: "ACKNOWLEDGED",
          acknowledgedBy: user.email,
          acknowledgedAt: now
        })
        .where(eq(alertEvents.id, existing.id));

      const [updated] = await db
        .select()
        .from(alertEvents)
        .where(eq(alertEvents.id, existing.id))
        .limit(1);

      return NextResponse.json({ ok: true, alert: updated });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
