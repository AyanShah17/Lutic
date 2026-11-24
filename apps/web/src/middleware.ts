import { NextResponse, type NextRequest } from "next/server";
import { buildCorsHeaders } from "@/lib/cors";

export const config = {
  matcher: "/api/:path*"
};

export function middleware(req: NextRequest) {
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
