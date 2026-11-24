import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  auditLog,
  eq,
  isDemoMode,
  RoleSchema,
  signSessionToken,
  userPlants,
  users,
  type SessionUser
} from "@kojo/core";
import { getWebAdministrativeDb } from "@/lib/db";
import {
  getSessionCookieOptions,
  handleApiError,
  problemResponse,
  SESSION_COOKIE_NAME,
  verifyCsrfOrigin
} from "@/lib/auth";

const DemoSwitchSchema = z.object({
  email: z.string().email()
});

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    if (!isDemoMode() || process.env.ALLOW_DEMO_SWITCH === "false") {
      return problemResponse(404, "Not Found", "Demo role switching is disabled.");
    }

    const { email } = DemoSwitchSchema.parse(await req.json());
    if (!email.endsWith("@acme.demo")) {
      return problemResponse(403, "Forbidden", "Only seeded @acme.demo accounts can be switched in demo mode.");
    }

    const db = await getWebAdministrativeDb();
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    const dbUser = rows[0];
    if (!dbUser || !dbUser.active) {
      return problemResponse(404, "Not Found", "Demo account not found.");
    }

    const plantRows = await db
      .select({ plantId: userPlants.plantId })
      .from(userPlants)
      .where(eq(userPlants.userId, dbUser.id));

    const sessionUser: SessionUser = {
      userId: dbUser.id,
      tenantId: dbUser.tenantId,
      role: RoleSchema.parse(dbUser.role),
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
      action: "demo_switch",
      toolName: "auth.demo_switch",
      args: { email: sessionUser.email },
      resultHash: "",
      status: "allowed",
      reason: "Demo persona switched",
      latencyMs: 1
    });

    const res = NextResponse.json({ user: sessionUser, token });
    res.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
