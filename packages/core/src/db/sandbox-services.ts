import crypto from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { A2UISpecSchema, type A2UISpec } from "../a2ui";
import { getPlanLimits, PlanLimitError } from "../plan-limits";
import {
  buildVirtualDefaultSandboxServices,
  computeAgentCapabilities,
  isSandboxServiceId,
  SANDBOX_SERVICE_CATALOG,
  SANDBOX_SERVICE_MAP,
  validateServiceSkillIds,
  type AgentCapabilities,
  type SandboxServiceId,
  type TenantSandboxServiceView
} from "../sandbox-services";
import type { LuticDatabase } from "./client";
import { sandboxServices, tenants } from "./schema";

export const OVERVIEW_PROFILE_SERVICE_ID = "overview";

export interface TenantWorkspaceProfile {
  onboardingCompleted: boolean;
  goal: string;
  teamSize: string;
  primaryUseCase: string;
  pinnedA2UI: A2UISpec[];
}

const DEFAULT_NEW_PROFILE: TenantWorkspaceProfile = {
  onboardingCompleted: false,
  goal: "",
  teamSize: "",
  primaryUseCase: "",
  pinnedA2UI: []
};

const DEFAULT_LEGACY_PROFILE: TenantWorkspaceProfile = {
  onboardingCompleted: true,
  goal: "",
  teamSize: "",
  primaryUseCase: "",
  pinnedA2UI: []
};

function parseProfileJson(raw: string | null | undefined, fallbackCompleted: boolean): TenantWorkspaceProfile {
  const base = fallbackCompleted ? DEFAULT_LEGACY_PROFILE : DEFAULT_NEW_PROFILE;
  if (!raw) return { ...base };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rawPinned = Array.isArray(parsed.pinnedA2UI) ? parsed.pinnedA2UI : [];
    const pinnedA2UI: A2UISpec[] = [];
    for (const item of rawPinned) {
      const check = A2UISpecSchema.safeParse(item);
      if (check.success) pinnedA2UI.push(check.data);
    }
    return {
      onboardingCompleted:
        typeof parsed.onboardingCompleted === "boolean"
          ? parsed.onboardingCompleted
          : fallbackCompleted,
      goal: typeof parsed.goal === "string" ? parsed.goal : "",
      teamSize: typeof parsed.teamSize === "string" ? parsed.teamSize : "",
      primaryUseCase: typeof parsed.primaryUseCase === "string" ? parsed.primaryUseCase : "",
      pinnedA2UI: pinnedA2UI.slice(0, 6)
    };
  } catch {
    return { ...base };
  }
}

function mapRowsToViews(
  rows: Array<typeof sandboxServices.$inferSelect>
): TenantSandboxServiceView[] {
  const byId = new Map(
    rows
      .filter((r) => r.serviceId !== OVERVIEW_PROFILE_SERVICE_ID)
      .map((r) => [r.serviceId, r])
  );
  const views = SANDBOX_SERVICE_CATALOG.map((def, idx) => {
    const row = byId.get(def.id);
    if (!row) {
      return {
        ...def,
        enabled: false,
        pinnedToDashboard: false,
        enabledSkills: def.skills.map((s) => s.id),
        agentInstructions: "",
        displayOrder: idx
      };
    }
    const validSkills = validateServiceSkillIds(
      def.id,
      Array.isArray(row.enabledSkills) ? row.enabledSkills : []
    ).normalized;
    return {
      ...def,
      enabled: Boolean(row.enabled),
      pinnedToDashboard: Boolean(row.pinnedToDashboard),
      enabledSkills: validSkills,
      agentInstructions: row.agentInstructions ?? "",
      displayOrder: Number.isFinite(row.displayOrder) ? row.displayOrder : idx
    };
  });
  return views.sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Returns the tenant's customized sandbox services and per-service skills.
 * Legacy/demo tenants with no sandbox service rows fall back to all services enabled until customized.
 */
export async function getTenantSandboxServices(
  db: LuticDatabase,
  tenantId: string
): Promise<TenantSandboxServiceView[]> {
  const rows = await db
    .select()
    .from(sandboxServices)
    .where(eq(sandboxServices.tenantId, tenantId))
    .orderBy(asc(sandboxServices.displayOrder));

  const serviceRows = rows.filter((r) => r.serviceId !== OVERVIEW_PROFILE_SERVICE_ID);
  if (serviceRows.length === 0) {
    return buildVirtualDefaultSandboxServices();
  }
  return mapRowsToViews(serviceRows);
}

export async function getOverviewAgentSummary(
  db: LuticDatabase,
  tenantId: string
): Promise<AgentCapabilities> {
  const services = await getTenantSandboxServices(db, tenantId);
  return computeAgentCapabilities(services, "overview");
}

export async function getTenantWorkspaceProfile(
  db: LuticDatabase,
  tenantId: string
): Promise<TenantWorkspaceProfile> {
  const rows = await db
    .select()
    .from(sandboxServices)
    .where(eq(sandboxServices.tenantId, tenantId));

  const profileRow = rows.find((r) => r.serviceId === OVERVIEW_PROFILE_SERVICE_ID);
  const hasEnabledService = rows.some(
    (r) => r.serviceId !== OVERVIEW_PROFILE_SERVICE_ID && r.enabled
  );

  // Legacy/demo tenants with zero sandbox_services rows default to completed onboarding.
  if (rows.length === 0) {
    return { ...DEFAULT_LEGACY_PROFILE };
  }
  if (!profileRow) {
    return { ...DEFAULT_LEGACY_PROFILE, onboardingCompleted: hasEnabledService || rows.length === 0 };
  }
  return parseProfileJson(profileRow.agentInstructions, hasEnabledService);
}

async function upsertOverviewProfileRow(
  db: LuticDatabase,
  tenantId: string,
  profile: TenantWorkspaceProfile
): Promise<void> {
  const now = new Date();
  const payload = JSON.stringify({
    onboardingCompleted: profile.onboardingCompleted,
    goal: profile.goal,
    teamSize: profile.teamSize,
    primaryUseCase: profile.primaryUseCase,
    pinnedA2UI: profile.pinnedA2UI.slice(0, 6)
  });

  const existing = await db
    .select({ id: sandboxServices.id })
    .from(sandboxServices)
    .where(
      and(
        eq(sandboxServices.tenantId, tenantId),
        eq(sandboxServices.serviceId, OVERVIEW_PROFILE_SERVICE_ID)
      )
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(sandboxServices)
      .set({ agentInstructions: payload, updatedAt: now })
      .where(eq(sandboxServices.id, existing[0].id));
  } else {
    await db.insert(sandboxServices).values({
      id: `sbx-${tenantId}-overview-${crypto.randomUUID().slice(0, 6)}`,
      tenantId,
      serviceId: OVERVIEW_PROFILE_SERVICE_ID,
      enabled: true,
      pinnedToDashboard: false,
      enabledSkills: [],
      agentInstructions: payload,
      displayOrder: -1,
      createdAt: now,
      updatedAt: now
    });
  }
}

export async function saveTenantWorkspaceProfile(
  db: LuticDatabase,
  tenantId: string,
  updater: (current: TenantWorkspaceProfile) => TenantWorkspaceProfile
): Promise<TenantWorkspaceProfile> {
  const current = await getTenantWorkspaceProfile(db, tenantId);
  const next = updater(current);
  await upsertOverviewProfileRow(db, tenantId, {
    ...next,
    pinnedA2UI: next.pinnedA2UI.slice(0, 6)
  });
  return { ...next, pinnedA2UI: next.pinnedA2UI.slice(0, 6) };
}

/**
 * Seeds fresh SaaS signups with 0 active services + uncompleted onboarding walkthrough row.
 */
export async function seedStarterSandboxServices(
  db: LuticDatabase,
  tenantId: string
): Promise<void> {
  const now = new Date();
  await db.insert(sandboxServices).values([
    {
      id: `sbx-${tenantId}-overview-${crypto.randomUUID().slice(0, 6)}`,
      tenantId,
      serviceId: OVERVIEW_PROFILE_SERVICE_ID,
      enabled: true,
      pinnedToDashboard: false,
      enabledSkills: [],
      agentInstructions: JSON.stringify(DEFAULT_NEW_PROFILE),
      displayOrder: -1,
      createdAt: now,
      updatedAt: now
    },
    ...SANDBOX_SERVICE_CATALOG.map((def, idx) => ({
      id: `sbx-${tenantId}-${def.id}-${crypto.randomUUID().slice(0, 6)}`,
      tenantId,
      serviceId: def.id,
      enabled: false,
      pinnedToDashboard: false,
      enabledSkills: def.skills.map((s) => s.id),
      agentInstructions: "",
      displayOrder: idx,
      createdAt: now,
      updatedAt: now
    }))
  ]);
}

export interface UpsertSandboxServiceInput {
  serviceId: string;
  enabled?: boolean;
  pinnedToDashboard?: boolean;
  enabledSkills?: string[];
  agentInstructions?: string;
  displayOrder?: number;
}

export async function upsertTenantSandboxService(
  db: LuticDatabase,
  tenantId: string,
  input: UpsertSandboxServiceInput
): Promise<TenantSandboxServiceView[]> {
  if (!isSandboxServiceId(input.serviceId)) {
    throw new Error(`Unknown sandbox service '${input.serviceId}'.`);
  }
  const def = SANDBOX_SERVICE_MAP[input.serviceId];

  if (input.enabledSkills !== undefined) {
    const check = validateServiceSkillIds(def.id, input.enabledSkills);
    if (!check.valid) {
      throw new Error(
        `Skills [${check.invalidSkills.join(", ")}] do not belong to service '${def.name}'.`
      );
    }
  }

  const [existingRows, tenantRows] = await Promise.all([
    db.select().from(sandboxServices).where(eq(sandboxServices.tenantId, tenantId)),
    db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  ]);

  const plan = tenantRows[0]?.plan ?? "free";
  const limits = getPlanLimits(plan);
  const existingServiceRows = existingRows.filter((r) => r.serviceId !== OVERVIEW_PROFILE_SERVICE_ID);

  const now = new Date();
  if (existingServiceRows.length === 0) {
    await db.insert(sandboxServices).values(
      SANDBOX_SERVICE_CATALOG.map((item, idx) => ({
        id: `sbx-${tenantId}-${item.id}-${crypto.randomUUID().slice(0, 6)}`,
        tenantId,
        serviceId: item.id,
        enabled: true,
        pinnedToDashboard: true,
        enabledSkills: item.skills.map((s) => s.id),
        agentInstructions: "",
        displayOrder: idx,
        createdAt: now,
        updatedAt: now
      }))
    );
  }

  const currentRows = await db
    .select()
    .from(sandboxServices)
    .where(
      and(
        eq(sandboxServices.tenantId, tenantId),
        eq(sandboxServices.serviceId, def.id)
      )
    )
    .limit(1);

  const existing = currentRows[0];
  const nextEnabled = input.enabled ?? existing?.enabled ?? true;

  if (nextEnabled && !existing?.enabled) {
    const allServiceRows = await db
      .select({ serviceId: sandboxServices.serviceId, enabled: sandboxServices.enabled })
      .from(sandboxServices)
      .where(eq(sandboxServices.tenantId, tenantId));
    const activeCount = allServiceRows.filter(
      (r) => r.serviceId !== OVERVIEW_PROFILE_SERVICE_ID && r.enabled
    ).length;
    if (activeCount >= limits.maxServices) {
      throw new PlanLimitError(
        `Your ${plan} plan allows up to ${limits.maxServices} active services and ${limits.maxAgents} AI agents. Remove a service before adding another.`
      );
    }
  }

  const nextPinned =
    input.pinnedToDashboard !== undefined
      ? input.pinnedToDashboard
      : input.enabled === true && existing && !existing.enabled
        ? true
        : nextEnabled
          ? (existing?.pinnedToDashboard ?? true)
          : false;
  const nextSkills =
    input.enabledSkills !== undefined
      ? validateServiceSkillIds(def.id, input.enabledSkills).normalized
      : existing?.enabledSkills ?? def.skills.map((s) => s.id);
  const nextInstructions =
    input.agentInstructions !== undefined
      ? input.agentInstructions
      : existing?.agentInstructions ?? "";
  const nextOrder =
    input.displayOrder !== undefined
      ? input.displayOrder
      : existing?.displayOrder ?? SANDBOX_SERVICE_CATALOG.findIndex((s) => s.id === def.id);

  if (existing) {
    await db
      .update(sandboxServices)
      .set({
        enabled: nextEnabled,
        pinnedToDashboard: nextPinned,
        enabledSkills: nextSkills,
        agentInstructions: nextInstructions,
        displayOrder: nextOrder,
        updatedAt: now
      })
      .where(eq(sandboxServices.id, existing.id));
  } else {
    await db.insert(sandboxServices).values({
      id: `sbx-${tenantId}-${def.id}-${crypto.randomUUID().slice(0, 6)}`,
      tenantId,
      serviceId: def.id,
      enabled: nextEnabled,
      pinnedToDashboard: nextPinned,
      enabledSkills: nextSkills,
      agentInstructions: nextInstructions,
      displayOrder: nextOrder,
      createdAt: now,
      updatedAt: now
    });
  }

  return getTenantSandboxServices(db, tenantId);
}

export async function completeTenantOnboarding(
  db: LuticDatabase,
  tenantId: string,
  input: {
    goal: string;
    teamSize?: string;
    primaryUseCase?: string;
    serviceIds: SandboxServiceId[];
    initialA2UI?: A2UISpec;
  }
): Promise<{
  services: TenantSandboxServiceView[];
  profile: TenantWorkspaceProfile;
}> {
  const uniqueIds = Array.from(new Set(input.serviceIds)).filter((id): id is SandboxServiceId =>
    isSandboxServiceId(id)
  );
  if (uniqueIds.length === 0) {
    throw new Error("Select at least 1 service to launch your workspace.");
  }

  const tenantRows = await db
    .select({ plan: tenants.plan })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const plan = tenantRows[0]?.plan ?? "free";
  const limits = getPlanLimits(plan);

  if (uniqueIds.length > limits.maxServices) {
    throw new PlanLimitError(
      `Your ${plan} plan allows up to ${limits.maxServices} services and ${limits.maxAgents} AI agents.`
    );
  }

  const selectedSet = new Set<SandboxServiceId>(uniqueIds);
  const existingRows = await db
    .select()
    .from(sandboxServices)
    .where(eq(sandboxServices.tenantId, tenantId));
  const byId = new Map(existingRows.map((r) => [r.serviceId, r]));
  const now = new Date();

  for (let idx = 0; idx < SANDBOX_SERVICE_CATALOG.length; idx += 1) {
    const def = SANDBOX_SERVICE_CATALOG[idx]!;
    const enabled = selectedSet.has(def.id);
    const existing = byId.get(def.id);
    if (existing) {
      await db
        .update(sandboxServices)
        .set({ enabled, pinnedToDashboard: enabled, updatedAt: now })
        .where(eq(sandboxServices.id, existing.id));
    } else {
      await db.insert(sandboxServices).values({
        id: `sbx-${tenantId}-${def.id}-${crypto.randomUUID().slice(0, 6)}`,
        tenantId,
        serviceId: def.id,
        enabled,
        pinnedToDashboard: enabled,
        enabledSkills: def.skills.map((s) => s.id),
        agentInstructions: "",
        displayOrder: idx,
        createdAt: now,
        updatedAt: now
      });
    }
  }

  const currentProfile = await getTenantWorkspaceProfile(db, tenantId);
  const nextProfile: TenantWorkspaceProfile = {
    onboardingCompleted: true,
    goal: input.goal.trim(),
    teamSize: input.teamSize?.trim() || currentProfile.teamSize,
    primaryUseCase: input.primaryUseCase?.trim() || currentProfile.primaryUseCase,
    pinnedA2UI: input.initialA2UI
      ? [input.initialA2UI, ...currentProfile.pinnedA2UI.filter((s) => s.id !== input.initialA2UI!.id)].slice(0, 6)
      : currentProfile.pinnedA2UI
  };
  await upsertOverviewProfileRow(db, tenantId, nextProfile);

  return {
    services: await getTenantSandboxServices(db, tenantId),
    profile: nextProfile
  };
}
