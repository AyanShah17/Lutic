import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { buildCorsHeaders } from "@/lib/cors";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
    "/api/:path*"
  ]
};

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
  if (clerkHandler) {
    return clerkHandler(req, event ?? ({} as NextFetchEvent));
  }
  return applyCors(req);
}

export default middleware;
