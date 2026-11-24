import { NextResponse } from "next/server";
import { and, authorize, conversations, desc, eq } from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { getSessionUser, handleApiError, problemResponse } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "docs:read", { tenantId: user.tenantId });

    const { searchParams } = new URL(req.url);
    const machineId = searchParams.get("machineId");

    const conds = [
      eq(conversations.tenantId, user.tenantId),
      eq(conversations.userId, user.userId)
    ];
    if (machineId) {
      conds.push(eq(conversations.machineId, machineId));
    }

    return await withWebTenantDb(user.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(conversations)
        .where(and(...conds))
        .orderBy(desc(conversations.updatedAt))
        .limit(50);

      return NextResponse.json({ conversations: rows });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
