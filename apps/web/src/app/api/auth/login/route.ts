import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  auditLog,
  and,
  consumeRateLimit,
  eq,
  RoleSchema,
  signSessionToken,
  userPlants,
  users,
  verifyPassword,
  type SessionUser
} from "@lutic/core";
import { getWebAdministrativeDb } from "@/lib/db";
import { readBoundedBody } from "@/lib/request-body";
import {
  getSessionCookieOptions,
  handleApiError,
  problemResponse,
  SESSION_COOKIE_NAME,
  verifyCsrfOrigin
} from "@/lib/auth";

const LoginSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(1024)
});

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    const body = LoginSchema.parse(await (await readBoundedBody(req, 8192)).json());
    const db = await getWebAdministrativeDb();
    const allowed = await consumeRateLimit(db, {
      scope: "auth-login", key: body.email, limit: 10, windowMs: 15 * 60 * 1000
    });
    if (!allowed) {
      const res = problemResponse(429, "Too Many Attempts", "Too many sign-in attempts. Try again in 15 minutes.");
      res.headers.set("Retry-After", "900");
      return res;
    }

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase().trim()))
      .limit(2);

    const dbUser = rows[0];
    if (rows.length !== 1 || !dbUser || !dbUser.active || !verifyPassword(body.password, dbUser.passwordHash)) {
      return problemResponse(401, "Unauthorized", "Invalid email or password.");
    }

    const plantRows = await db
      .select({ plantId: userPlants.plantId })
      .from(userPlants)
      .where(and(eq(userPlants.userId, dbUser.id), eq(userPlants.tenantId, dbUser.tenantId)));

    const role = RoleSchema.parse(dbUser.role);
    const sessionUser: SessionUser = {
      userId: dbUser.id,
      tenantId: dbUser.tenantId,
      role,
      plantIds: plantRows.map((p) => p.plantId),
      email: dbUser.email,
      name: dbUser.name
    };

    const token = await signSessionToken(sessionUser, {
      tokenVersion: dbUser.tokenVersion
    });

    await db.insert(auditLog).values({
      id: `aud-${crypto.randomUUID().slice(0, 12)}`,
      tenantId: sessionUser.tenantId,
      userId: sessionUser.userId,
      role: sessionUser.role,
      action: "login",
      toolName: "auth.login",
      args: { email: sessionUser.email },
      resultHash: "",
      status: "allowed",
      reason: "Credentials verified",
      latencyMs: 1
    });

    const res = NextResponse.json({ user: sessionUser, token });
    res.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
