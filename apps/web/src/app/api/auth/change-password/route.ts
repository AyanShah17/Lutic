import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  auditLog,
  consumeRateLimit,
  eq,
  hashPassword,
  revokedSessions,
  RoleSchema,
  sha256Hex,
  signSessionToken,
  sql,
  userPlants,
  users,
  verifyPassword
} from "@lutic/core";
import { getWebAdministrativeDb, withWebTenantDb } from "@/lib/db";
import { readBoundedBody } from "@/lib/request-body";
import {
  getSessionCookieOptions,
  getSessionToken,
  getSessionUser,
  handleApiError,
  problemResponse,
  SESSION_COOKIE_NAME,
  verifyCsrfOrigin
} from "@/lib/auth";

const ChangePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z
    .string()
    .min(12, "New password must be at least 12 characters")
    .max(1024)
    .refine(
      (pw) => pw !== "lutic-demo-password" && new Set(pw).size >= 8,
      "Choose a unique password with varied characters"
    )
});

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    if (process.env.LUTIC_CLERK_ONLY === "true") {
      return problemResponse(
        403,
        "SSO Managed",
        "Password management is handled by Clerk."
      );
    }
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    const currentToken = await getSessionToken(req);

    const allowed = await consumeRateLimit(await getWebAdministrativeDb(), {
      scope: "auth-change-password",
      key: user.userId,
      limit: 10,
      windowMs: 15 * 60 * 1000
    });
    if (!allowed) {
      const res = problemResponse(
        429,
        "Too Many Attempts",
        "Too many password change attempts. Try again in 15 minutes."
      );
      res.headers.set("Retry-After", "900");
      return res;
    }

    const body = ChangePasswordSchema.parse(
      await (await readBoundedBody(req, 8192)).json()
    );
    if (body.currentPassword === body.newPassword) {
      return problemResponse(
        400,
        "Validation Error",
        "New password must differ from the current password."
      );
    }

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [dbUser] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, user.userId), eq(users.tenantId, user.tenantId)))
        .limit(1)
        .for("update");

      if (!dbUser || !dbUser.active || !verifyPassword(body.currentPassword, dbUser.passwordHash)) {
        return problemResponse(403, "Invalid Password", "Current password is incorrect.");
      }

      const [updated] = await db
        .update(users)
        .set({
          passwordHash: hashPassword(body.newPassword),
          passwordUpdatedAt: new Date(),
          tokenVersion: sql`${users.tokenVersion} + 1`
        })
        .where(
          and(
            eq(users.id, user.userId),
            eq(users.tenantId, user.tenantId),
            eq(users.active, true),
            eq(users.tokenVersion, dbUser.tokenVersion),
            eq(users.passwordHash, dbUser.passwordHash)
          )
        )
        .returning();

      if (!updated) {
        return problemResponse(
          409,
          "Conflict",
          "Concurrent password or account update detected; please retry."
        );
      }

      if (currentToken) {
        await db
          .insert(revokedSessions)
          .values({
            tokenHash: sha256Hex(currentToken),
            tenantId: user.tenantId,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          })
          .onConflictDoNothing();
      }

      const plantRows = await db
        .select({ plantId: userPlants.plantId })
        .from(userPlants)
        .where(and(eq(userPlants.userId, updated.id), eq(userPlants.tenantId, updated.tenantId)));

      const freshToken = await signSessionToken(
        {
          userId: updated.id,
          tenantId: updated.tenantId,
          role: RoleSchema.parse(updated.role),
          plantIds: plantRows.map((p) => p.plantId),
          email: updated.email,
          name: updated.name
        },
        { tokenVersion: updated.tokenVersion }
      );

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "change_password",
        toolName: "auth.change_password",
        args: { userId: user.userId },
        resultHash: "",
        status: "allowed",
        reason: "User rotated password and invalidated prior sessions",
        latencyMs: 1
      });

      const res = NextResponse.json({ ok: true, token: freshToken });
      res.cookies.set(SESSION_COOKIE_NAME, freshToken, getSessionCookieOptions());
      return res;
    });
  } catch (err) {
    return handleApiError(err);
  }
}
