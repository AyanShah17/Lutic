import { NextResponse } from "next/server";
import { and, eq, lt, revokedSessions, sha256Hex } from "@kojo/core";
import { withWebTenantDb } from "@/lib/db";
import { clearSessionCookie, getSessionToken, getSessionUser, handleApiError, verifyCsrfOrigin } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    const user = await getSessionUser(req);
    const token = await getSessionToken(req);
    if (user && token) {
      await withWebTenantDb(user.tenantId, async (db) => {
        await db.insert(revokedSessions).values({
          tokenHash: sha256Hex(token), tenantId: user.tenantId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }).onConflictDoNothing();
        await db.delete(revokedSessions).where(and(
          eq(revokedSessions.tenantId, user.tenantId), lt(revokedSessions.expiresAt, new Date())
        ));
      });
    }
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
