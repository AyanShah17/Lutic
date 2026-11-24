import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  and,
  AuthorizationError,
  eq,
  LicenseError,
  RoleSchema,
  logger,
  revokedSessions,
  sha256Hex,
  signSessionToken,
  userPlants,
  users,
  verifySessionToken,
  type SessionUser
} from "@lutic/core";
import { resolveCorsOrigin } from "./cors";
import { withWebTenantDb } from "./db";

export const SESSION_COOKIE_NAME = "lutic_session";

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      try { return decodeURIComponent(part.slice(idx + 1).trim()); }
      catch { return null; }
    }
  }
  return null;
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true",
    maxAge: 60 * 60 * 24 * 7
  };
}

export async function getSessionToken(req?: Request): Promise<string | null> {
  let authHeader: string | null = null;
  if (req) {
    authHeader = req.headers.get("authorization");
  } else {
    try {
      authHeader = (await headers()).get("authorization");
    } catch {
      authHeader = null;
    }
  }

  let token: string | undefined;
  if (authHeader && /^Bearer\s*/i.test(authHeader)) {
    // Explicit Bearer header: never fall back to cookies
    const extracted = authHeader.replace(/^Bearer\s*/i, "").trim();
    if (!extracted) return null;
    token = extracted;
  } else if (req) {
    token = parseCookie(req.headers.get("cookie"), SESSION_COOKIE_NAME) ?? undefined;
    if (!token) {
      try {
        token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
      } catch {
        // outside Next request context
      }
    }
  } else {
    token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  }

  if (!token) return null;
  return token;
}

export async function getSessionUser(req?: Request): Promise<SessionUser | null> {
  const token = await getSessionToken(req);
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;

  return withWebTenantDb(claims.tenantId, async (db) => {
    const revoked = await db.select({ hash: revokedSessions.tokenHash }).from(revokedSessions)
      .where(eq(revokedSessions.tokenHash, sha256Hex(token))).limit(1);
    if (revoked.length) return null;
    const userRows = await db
      .select()
      .from(users)
      .where(and(eq(users.id, claims.userId), eq(users.tenantId, claims.tenantId)))
      .limit(1);

    const dbUser = userRows[0];
    if (!dbUser || !dbUser.active) return null;
    if (dbUser.tokenVersion !== claims.tokenVersion) return null;

    const plantRows = await db
      .select({ plantId: userPlants.plantId })
      .from(userPlants)
      .where(
        and(
          eq(userPlants.userId, dbUser.id),
          eq(userPlants.tenantId, dbUser.tenantId)
        )
      );

    const roleParsed = RoleSchema.safeParse(dbUser.role);
    if (!roleParsed.success) return null;

    return {
      userId: dbUser.id,
      tenantId: dbUser.tenantId,
      role: roleParsed.data,
      plantIds: plantRows.map((p) => p.plantId),
      email: dbUser.email,
      name: dbUser.name
    };
  });
}

export async function setSessionCookie(
  user: SessionUser,
  res?: NextResponse,
  tokenVersion = 1
): Promise<string> {
  const token = await signSessionToken(user, { tokenVersion });
  const opts = getSessionCookieOptions();
  if (res) {
    res.cookies.set(SESSION_COOKIE_NAME, token, opts);
  } else {
    try {
      (await cookies()).set(SESSION_COOKIE_NAME, token, opts);
    } catch {
      // outside Next request context
    }
  }
  return token;
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.delete(SESSION_COOKIE_NAME);
}

/**
 * CSRF & Origin verification for state-changing HTTP endpoints.
 */
export function verifyCsrfOrigin(req: Request): void {
  const hdrs = req.headers;
  const authHeader = hdrs.get("authorization");
  if (authHeader && /^Bearer\s+\S+/i.test(authHeader)) {
    return;
  }

  const origin = hdrs.get("origin");
  const host = hdrs.get("host");
  if (!origin || !host) return;
  try {
    const originHost = new URL(origin).host;
    if (originHost !== host && resolveCorsOrigin(origin) === null) {
      throw new AuthorizationError("Cross-origin state-changing request rejected");
    }
  } catch (err) {
    if (err instanceof AuthorizationError) throw err;
    throw new AuthorizationError("Invalid request origin header");
  }
}

export function problemResponse(
  status: number,
  title: string,
  detail: string
): NextResponse {
  return NextResponse.json(
    {
      type: `https://lutic.app/errors/${status}`,
      title,
      status,
      detail
    },
    { status }
  );
}

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof Error && err.name === "UploadScanUnavailableError") {
    return problemResponse(503, "Scanner Unavailable", err.message);
  }
  if (err instanceof Error && err.name === "RequestBodyTooLargeError") {
    return problemResponse(413, "Payload Too Large", err.message);
  }
  if (err instanceof Error && err.name === "LLMTimeoutError") {
    return problemResponse(504, "Upstream Timeout", err.message);
  }
  if (err instanceof Error && err.name === "AbortError") {
    return problemResponse(499, "Request Cancelled", err.message);
  }
  if (err instanceof SyntaxError) {
    return problemResponse(400, "Invalid Request", "Request body is not valid JSON.");
  }
  if (err instanceof LicenseError) {
    return problemResponse(err.statusCode, "License Required", err.message);
  }
  if (err instanceof AuthorizationError) {
    return problemResponse(403, "Forbidden", err.message);
  }
  if (err instanceof ZodError) {
    return problemResponse(
      400,
      "Validation Error",
      err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
  }
  logger.error({ err }, "API request failed");
  const msg = process.env.NODE_ENV !== "production" && err instanceof Error
    ? err.message
    : "An unexpected error occurred. Please try again later.";
  return problemResponse(500, "Internal Error", msg);
}
