import { NextResponse } from "next/server";
import { z } from "zod";
import {
  consumeRateLimit,
  eq,
  hashPassword,
  signSessionToken,
  users
} from "@lutic/core";
import {
  getSessionCookieOptions,
  handleApiError,
  problemResponse,
  SESSION_COOKIE_NAME,
  verifyCsrfOrigin
} from "@/lib/auth";
import { isEnterpriseDeployment } from "@/lib/clerk";
import { getWebAdministrativeDb } from "@/lib/db";
import { getClientIp } from "@/lib/quota";
import { readBoundedBody } from "@/lib/request-body";
import { provisionTenantWorkspace } from "@/lib/tenant-provisioning";

const SignupSchema = z.object({
  name: z.string().trim().min(1, "Full name is required").max(120),
  workspaceName: z.string().trim().max(140).optional().default(""),
  email: z
    .string()
    .trim()
    .email("Enter a valid work email")
    .max(254)
    .transform((email) => email.toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters").max(1024)
});

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === "23505" || e.cause?.code === "23505";
}

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    if (process.env.LUTIC_CLERK_ONLY === "true") {
      return problemResponse(
        403,
        "SSO Required",
        "Local signup is disabled in production. Sign up with Clerk."
      );
    }
    const body = SignupSchema.parse(await (await readBoundedBody(req, 8192)).json());
    const db = await getWebAdministrativeDb();

    if (await isEnterpriseDeployment(db)) {
      return problemResponse(
        403,
        "Invitation Required",
        "Self-serve signup is disabled on Enterprise invite-only deployments."
      );
    }

    const clientIp = getClientIp(req);
    if (clientIp !== "local") {
      const ipAllowed = await consumeRateLimit(db, {
        scope: "auth-signup-ip",
        key: clientIp,
        limit: 20,
        windowMs: 15 * 60 * 1000
      });
      if (!ipAllowed) {
        const res = problemResponse(
          429,
          "Too Many Attempts",
          "Too many signup attempts from this IP. Try again in 15 minutes."
        );
        res.headers.set("Retry-After", "900");
        return res;
      }
    }

    const allowed = await consumeRateLimit(db, {
      scope: "auth-signup",
      key: body.email,
      limit: 10,
      windowMs: 15 * 60 * 1000
    });
    if (!allowed) {
      const res = problemResponse(
        429,
        "Too Many Attempts",
        "Too many signup attempts. Try again in 15 minutes."
      );
      res.headers.set("Retry-After", "900");
      return res;
    }

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    if (existing.length > 0) {
      return problemResponse(
        409,
        "Account Exists",
        "An account with this email already exists. Please sign in."
      );
    }

    let provisioned;
    try {
      provisioned = await provisionTenantWorkspace(db, {
        email: body.email,
        name: body.name,
        workspaceName: body.workspaceName,
        passwordHash: hashPassword(body.password),
        authSource: "auth.signup"
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return problemResponse(
          409,
          "Account Exists",
          "An account with this email already exists. Please sign in."
        );
      }
      throw err;
    }

    const token = await signSessionToken(provisioned.sessionUser, {
      tokenVersion: provisioned.userRow.tokenVersion
    });

    const res = NextResponse.json(
      { user: provisioned.sessionUser, token },
      { status: 201 }
    );
    res.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
