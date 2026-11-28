import { NextResponse } from "next/server";
import {
  connectorConnections,
  consumeRateLimit,
  eq,
  getPlanLimits,
  getUtcDayKey,
  normalizePlanTier,
  secondsUntilUtcMidnight,
  tenants,
  type LuticDatabase,
  type PlanTier,
  type RateLimitConsumer,
  type SessionUser
} from "@lutic/core";
import { problemResponse } from "@/lib/auth";

export const LEGACY_INTERNAL_CONNECTOR_SLUGS = new Set([
  "cmms",
  "historian",
  "mes",
  "parts-erp",
  "docs",
  "ops-webhook",
  "lutic-cloud",
  "lutic-bridge",
  "lutic-api"
]);

export function isInternalConnectorRow(row: { transport: string; slug: string }): boolean {
  return (
    row.transport === "in_memory_mcp" ||
    LEGACY_INTERNAL_CONNECTOR_SLUGS.has(row.slug.toLowerCase())
  );
}

export function getClientIp(req: Request): string {
  if (process.env.LUTIC_TRUST_CLOUDFLARE_PROXY === "true") {
    const cfIp = req.headers.get("cf-connecting-ip")?.trim();
    if (cfIp) return cfIp;
  }
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  return realIp || "local";
}

export async function getTenantPlan(
  db: LuticDatabase,
  tenantId: string
): Promise<PlanTier> {
  const rows = await db
    .select({ plan: tenants.plan })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return normalizePlanTier(rows[0]?.plan);
}

export async function getTenantVisibleConnectorCount(
  db: LuticDatabase,
  tenantId: string
): Promise<number> {
  const rows = await db
    .select({
      transport: connectorConnections.transport,
      slug: connectorConnections.slug
    })
    .from(connectorConnections)
    .where(eq(connectorConnections.tenantId, tenantId));

  return rows.filter((r) => !isInternalConnectorRow(r)).length;
}

function rateLimitResponse(detail: string, retryAfterSec: number): NextResponse {
  const res = problemResponse(429, "Too Many Requests", detail);
  res.headers.set("Retry-After", String(Math.max(1, Math.floor(retryAfterSec))));
  return res;
}

export async function enforceApiQuota(
  req: Request,
  db: LuticDatabase,
  user: SessionUser,
  kind: "api" | "ai",
  options?: { consumeQuota?: RateLimitConsumer }
): Promise<NextResponse | null> {
  const plan = await getTenantPlan(db, user.tenantId);
  const limits = getPlanLimits(plan);
  const consume: RateLimitConsumer =
    options?.consumeQuota ?? ((bucket) => consumeRateLimit(db, bucket));

  const perMinLimit = kind === "ai" ? limits.aiRequestsPerMinute : limits.apiRequestsPerMinute;
  const dailyLimit = kind === "ai" ? limits.aiRequestsPerDay : limits.apiRequestsPerDay;
  const label = kind === "ai" ? "AI requests" : "API requests";

  const minOk = await consume({
    scope: kind === "ai" ? "ai-min" : "api-min",
    key: JSON.stringify([user.tenantId, user.userId]),
    limit: perMinLimit,
    windowMs: 60_000
  });
  if (!minOk) {
    return rateLimitResponse(
      `Rate limit reached (${perMinLimit} ${label}/minute on ${plan} plan). Please retry shortly.`,
      60
    );
  }

  const dayOk = await consume({
    scope: kind === "ai" ? "ai-day" : "api-day",
    key: JSON.stringify([user.tenantId, user.userId, getUtcDayKey()]),
    limit: dailyLimit,
    windowMs: 86_400_000
  });
  if (!dayOk) {
    return rateLimitResponse(
      `Daily limit reached (${dailyLimit} ${label}/day on ${plan} plan). Resets at 00:00 UTC.`,
      secondsUntilUtcMidnight()
    );
  }

  const clientIp = getClientIp(req);
  if (clientIp !== "local") {
    const ipOk = await consume({
      scope: "ip-burst",
      key: clientIp,
      limit: Math.max(limits.apiRequestsPerMinute * 2, 60),
      windowMs: 60_000
    });
    if (!ipOk) {
      return rateLimitResponse(
        "Request rate from this IP exceeded the temporary limit. Please retry shortly.",
        60
      );
    }
  }

  return null;
}

export async function enforceConnectorQuota(
  db: LuticDatabase,
  tenantId: string
): Promise<NextResponse | null> {
  const [plan, count] = await Promise.all([
    getTenantPlan(db, tenantId),
    getTenantVisibleConnectorCount(db, tenantId)
  ]);
  const limits = getPlanLimits(plan);
  if (count >= limits.maxConnectors) {
    return problemResponse(
      403,
      "Plan Limit Reached",
      `Your ${plan} plan allows up to ${limits.maxConnectors} connectors. Remove an existing connector or upgrade to add more.`
    );
  }
  return null;
}
