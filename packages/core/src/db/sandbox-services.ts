import crypto from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  buildVirtualDefaultSandboxServices,
  computeAgentCapabilities,
  isSandboxServiceId,
  SANDBOX_SERVICE_CATALOG,
  SANDBOX_SERVICE_MAP,
  STARTER_SANDBOX_SERVICE_IDS,
  validateServiceSkillIds,
  type AgentCapabilities,
  type SandboxServiceId,
  type TenantSandboxServiceView
} from "../sandbox-services";
import type { LuticDatabase } from "./client";
import { sandboxServices } from "./schema";

function mapRowsToViews(
  rows: Array<typeof sandboxServices.$inferSelect>
): TenantSandboxServiceView[] {
  const byId = new Map(rows.map((r) => [r.serviceId, r]));
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
 * Legacy/demo tenants with no sandbox rows fall back to all services enabled until customized.
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

  if (rows.length === 0) {
    return buildVirtualDefaultSandboxServices();
  }
  return mapRowsToViews(rows);
}

export async function getOverviewAgentSummary(
  db: LuticDatabase,
  tenantId: string
): Promise<AgentCapabilities> {
  const services = await getTenantSandboxServices(db, tenantId);
  return computeAgentCapabilities(services, "overview");
}

/**
 * Seeds isolated starter sandbox services for newly signed-up SaaS tenants.
 */
export async function seedStarterSandboxServices(
  db: LuticDatabase,
  tenantId: string
): Promise<void> {
  const starterSet = new Set<SandboxServiceId>(STARTER_SANDBOX_SERVICE_IDS);
  const now = new Date();
  await db.insert(sandboxServices).values(
    SANDBOX_SERVICE_CATALOG.map((def, idx) => {
      const enabled = starterSet.has(def.id);
      return {
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
      };
    })
  );
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

  const existingRows = await db
    .select()
    .from(sandboxServices)
    .where(eq(sandboxServices.tenantId, tenantId));

  const now = new Date();
  // Materialize all catalog rows first when a legacy tenant customizes its first service.
  if (existingRows.length === 0) {
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
