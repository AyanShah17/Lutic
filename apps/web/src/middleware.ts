import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { buildCorsHeaders } from "@/lib/cors";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
    "/api/:path*"
  ]
};

function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i += 1) {
    diff |= ab[i]! ^ bb[i]!;
  }
  return diff === 0;
}

export function verifyOriginLock(req: NextRequest): NextResponse | null {
  const expected = process.env.LUTIC_ORIGIN_LOCK_SECRET?.trim();
  if (!expected) return null;

  const pathname = req.nextUrl.pathname;
  if (pathname === "/api/health/live") return null;

  const provided = req.headers.get("x-lutic-origin-secret")?.trim() ?? "";
  if (!provided || !constantTimeEqual(provided, expected)) {
    return NextResponse.json(
      {
        title: "Forbidden",
        status: 403,
        detail: "Direct origin access is blocked."
      },
      { status: 403 }
    );
  }
  return null;
}

function applyCors(req: NextRequest): NextResponse {
  if (!req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const corsHeaders = buildCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  const res = NextResponse.next();
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.headers.set(key, value);
  }
  return res;
}

const isClerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
    process.env.CLERK_SECRET_KEY?.trim()
);

const clerkHandler = isClerkConfigured
  ? clerkMiddleware((_auth, request) => applyCors(request))
  : null;

export function middleware(req: NextRequest, event?: NextFetchEvent) {
  const originError = verifyOriginLock(req);
  if (originError) return originError;

  if (clerkHandler) {
    return clerkHandler(req, event ?? ({} as NextFetchEvent));
  }
  return applyCors(req);
}

export default middleware;
