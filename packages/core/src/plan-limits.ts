export type PlanTier = "free" | "individual" | "enterprise";

export interface PlanLimits {
  plan: PlanTier;
  maxServices: number;
  maxAgents: number;
  maxConnectors: number;
  apiRequestsPerMinute: number;
  apiRequestsPerDay: number;
  aiRequestsPerMinute: number;
  aiRequestsPerDay: number;
  toolCallsPerMinute: number;
  toolCallsPerDay: number;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    plan: "free",
    maxServices: 3,
    maxAgents: 3,
    maxConnectors: 5,
    apiRequestsPerMinute: 30,
    apiRequestsPerDay: 500,
    aiRequestsPerMinute: 10,
    aiRequestsPerDay: 60,
    toolCallsPerMinute: 12,
    toolCallsPerDay: 100
  },
  individual: {
    plan: "individual",
    maxServices: 8,
    maxAgents: 8,
    maxConnectors: 50,
    apiRequestsPerMinute: 120,
    apiRequestsPerDay: 5000,
    aiRequestsPerMinute: 40,
    aiRequestsPerDay: 500,
    toolCallsPerMinute: 60,
    toolCallsPerDay: 1500
  },
  enterprise: {
    plan: "enterprise",
    maxServices: 8,
    maxAgents: 8,
    maxConnectors: 500,
    apiRequestsPerMinute: 600,
    apiRequestsPerDay: 50000,
    aiRequestsPerMinute: 120,
    aiRequestsPerDay: 5000,
    toolCallsPerMinute: 120,
    toolCallsPerDay: 10000
  }
};

export function normalizePlanTier(plan?: string | null): PlanTier {
  const clean = (plan ?? "").trim().toLowerCase();
  if (clean === "enterprise") return "enterprise";
  if (clean === "individual" || clean === "pro") return "individual";
  return "free";
}

export function getPlanLimits(plan?: string | null): PlanLimits {
  return PLAN_LIMITS[normalizePlanTier(plan)];
}

export function getUtcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0
  );
  return Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000));
}

export class PlanLimitError extends Error {
  public readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}
