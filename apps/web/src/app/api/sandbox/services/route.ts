import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  auditLog,
  buildA2UIFromPrompt,
  completeTenantOnboarding,
  computeAgentCapabilities,
  getPlanLimits,
  getTenantSandboxServices,
  getTenantWorkspaceProfile,
  isSandboxServiceId,
  PlanLimitError,
  saveTenantWorkspaceProfile,
  upsertTenantSandboxService,
  type SandboxServiceId
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";
import {
  enforceApiQuota,
  getTenantPlan,
  getTenantVisibleConnectorCount
} from "@/lib/quota";

const UpsertServiceSchema = z.object({
  serviceId: z.string().min(1).max(48),
  enabled: z.boolean().optional(),
  pinnedToDashboard: z.boolean().optional(),
  enabledSkills: z.array(z.string().min(1).max(120)).max(50).optional(),
  agentInstructions: z.string().max(1000).optional(),
  displayOrder: z.number().int().min(0).max(100).optional()
});

const CompleteOnboardingSchema = z.object({
  action: z.literal("complete_onboarding"),
  goal: z.string().trim().max(500).default(""),
  teamSize: z.string().trim().max(64).optional().default(""),
  primaryUseCase: z.string().trim().max(120).optional().default(""),
  serviceIds: z.array(z.string().min(1).max(48)).min(1).max(8)
});

const ResetOnboardingSchema = z.object({
  action: z.literal("reset_onboarding")
});

const PostBodySchema = z.union([
  CompleteOnboardingSchema,
  ResetOnboardingSchema,
  UpsertServiceSchema
]);

function buildSandboxResponsePayload(
  services: Awaited<ReturnType<typeof getTenantSandboxServices>>,
  plan: Awaited<ReturnType<typeof getTenantPlan>>,
  connectorCount: number,
  workspaceProfile: Awaited<ReturnType<typeof getTenantWorkspaceProfile>>
) {
  const overview = computeAgentCapabilities(services, "overview");
  const limits = getPlanLimits(plan);
  const activeServices = overview.activeServiceIds.length;
  return {
    services,
    plan,
    limits,
    usage: {
      activeServices,
      activeAgents: activeServices,
      connectors: connectorCount
    },
    workspaceProfile,
    overviewAgent: {
      scopeId: overview.scopeId,
      agentId: overview.agentId,
      agentName: overview.agentName,
      activeServiceIds: overview.activeServiceIds,
      disabledServiceIds: overview.disabledServiceIds,
      activeSkills: overview.activeSkills.map((s) => s.id)
    }
  };
}

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) {
      return problemResponse(401, "Unauthorized", "Please sign in to view sandbox services.");
    }

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [services, plan, connectorCount, workspaceProfile] = await Promise.all([
        getTenantSandboxServices(db, user.tenantId),
        getTenantPlan(db, user.tenantId),
        getTenantVisibleConnectorCount(db, user.tenantId),
        getTenantWorkspaceProfile(db, user.tenantId)
      ]);
      return NextResponse.json(
        buildSandboxResponsePayload(services, plan, connectorCount, workspaceProfile)
      );
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) {
      return problemResponse(401, "Unauthorized", "Please sign in to configure sandbox services.");
    }

    const body = PostBodySchema.parse(await req.json());

    return await withWebTenantDb(user.tenantId, async (db) => {
      const quotaError = await enforceApiQuota(req, db, user, "api");
      if (quotaError) return quotaError;

      const plan = await getTenantPlan(db, user.tenantId);
      const connectorCount = await getTenantVisibleConnectorCount(db, user.tenantId);

      if ("action" in body && body.action === "reset_onboarding") {
        const [services, profile] = await Promise.all([
          getTenantSandboxServices(db, user.tenantId),
          saveTenantWorkspaceProfile(db, user.tenantId, (cur) => ({
            ...cur,
            onboardingCompleted: false
          }))
        ]);
        return NextResponse.json(
          buildSandboxResponsePayload(services, plan, connectorCount, profile)
        );
      }

      if ("action" in body && body.action === "complete_onboarding") {
        const validIds = body.serviceIds.filter((id): id is SandboxServiceId =>
          isSandboxServiceId(id)
        );
        if (validIds.length === 0) {
          return problemResponse(400, "Validation Error", "Select at least 1 valid service.");
        }
        const initialA2UI = body.goal.trim()
          ? buildA2UIFromPrompt({
              prompt: body.goal.trim(),
              activeServiceIds: validIds
            })
          : undefined;
        try {
          const result = await completeTenantOnboarding(db, user.tenantId, {
            goal: body.goal || "Custom Workspace Setup",
            teamSize: body.teamSize,
            primaryUseCase: body.primaryUseCase,
            serviceIds: validIds,
            initialA2UI
          });
          await db.insert(auditLog).values({
            id: `aud-sbx-${crypto.randomUUID().slice(0, 10)}`,
            tenantId: user.tenantId,
            userId: user.userId,
            role: user.role,
            action: "workspace_onboarding_completed",
            toolName: "sandbox.onboarding",
            args: { serviceIds: validIds, goal: body.goal.slice(0, 120) },
            resultHash: "",
            status: "allowed",
            reason: `Completed workspace setup with ${validIds.length} services`,
            latencyMs: 1
          });
          return NextResponse.json(
            buildSandboxResponsePayload(result.services, plan, connectorCount, result.profile)
          );
        } catch (err) {
          if (err instanceof PlanLimitError) {
            return problemResponse(403, "Plan Limit Reached", err.message);
          }
          return problemResponse(
            400,
            "Invalid Setup",
            err instanceof Error ? err.message : "Unable to complete setup."
          );
        }
      }

      const svcBody = body as z.infer<typeof UpsertServiceSchema>;
      if (!isSandboxServiceId(svcBody.serviceId)) {
        return problemResponse(400, "Validation Error", `Unknown service '${svcBody.serviceId}'.`);
      }

      let services;
      try {
        services = await upsertTenantSandboxService(db, user.tenantId, svcBody);
      } catch (err) {
        if (err instanceof PlanLimitError) {
          return problemResponse(403, "Plan Limit Reached", err.message);
        }
        return problemResponse(
          400,
          "Invalid Service Skills",
          err instanceof Error ? err.message : "Invalid sandbox service configuration."
        );
      }

      const profile = await getTenantWorkspaceProfile(db, user.tenantId);
      await db.insert(auditLog).values({
        id: `aud-sbx-${crypto.randomUUID().slice(0, 10)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "sandbox_service_updated",
        toolName: `sandbox.${svcBody.serviceId}`,
        args: {
          serviceId: svcBody.serviceId,
          enabled: svcBody.enabled,
          pinnedToDashboard: svcBody.pinnedToDashboard,
          enabledSkills: svcBody.enabledSkills
        },
        resultHash: "",
        status: "allowed",
        reason: `Updated sandbox configuration for service '${svcBody.serviceId}'`,
        latencyMs: 1
      });

      return NextResponse.json(
        buildSandboxResponsePayload(services, plan, connectorCount, profile)
      );
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) {
      return problemResponse(401, "Unauthorized", "Please sign in to remove sandbox services.");
    }

    const url = new URL(req.url);
    let serviceId = url.searchParams.get("serviceId") ?? "";
    if (!serviceId) {
      const json = (await req.json().catch(() => ({}))) as { serviceId?: string };
      serviceId = String(json.serviceId ?? "");
    }
    if (!isSandboxServiceId(serviceId)) {
      return problemResponse(400, "Validation Error", `Unknown service '${serviceId}'.`);
    }

    return await withWebTenantDb(user.tenantId, async (db) => {
      const quotaError = await enforceApiQuota(req, db, user, "api");
      if (quotaError) return quotaError;

      const services = await upsertTenantSandboxService(db, user.tenantId, {
        serviceId,
        enabled: false,
        pinnedToDashboard: false
      });
      const [plan, connectorCount, profile] = await Promise.all([
        getTenantPlan(db, user.tenantId),
        getTenantVisibleConnectorCount(db, user.tenantId),
        getTenantWorkspaceProfile(db, user.tenantId)
      ]);

      await db.insert(auditLog).values({
        id: `aud-sbx-${crypto.randomUUID().slice(0, 10)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "sandbox_service_removed",
        toolName: `sandbox.${serviceId}`,
        args: { serviceId },
        resultHash: "",
        status: "allowed",
        reason: `Removed service '${serviceId}' from sandbox`,
        latencyMs: 1
      });

      return NextResponse.json(
        buildSandboxResponsePayload(services, plan, connectorCount, profile)
      );
    });
  } catch (err) {
    return handleApiError(err);
  }
}
