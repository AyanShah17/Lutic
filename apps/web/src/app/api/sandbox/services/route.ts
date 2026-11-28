import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  auditLog,
  computeAgentCapabilities,
  getTenantSandboxServices,
  isSandboxServiceId,
  upsertTenantSandboxService
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const UpsertServiceSchema = z.object({
  serviceId: z.string().min(1).max(48),
  enabled: z.boolean().optional(),
  pinnedToDashboard: z.boolean().optional(),
  enabledSkills: z.array(z.string().min(1).max(120)).max(50).optional(),
  agentInstructions: z.string().max(1000).optional(),
  displayOrder: z.number().int().min(0).max(100).optional()
});

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) {
      return problemResponse(401, "Unauthorized", "Please sign in to view sandbox services.");
    }

    return await withWebTenantDb(user.tenantId, async (db) => {
      const services = await getTenantSandboxServices(db, user.tenantId);
      const overview = computeAgentCapabilities(services, "overview");
      return NextResponse.json({
        services,
        overviewAgent: {
          scopeId: overview.scopeId,
          agentId: overview.agentId,
          agentName: overview.agentName,
          activeServiceIds: overview.activeServiceIds,
          disabledServiceIds: overview.disabledServiceIds,
          activeSkills: overview.activeSkills.map((s) => s.id)
        }
      });
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

    const body = UpsertServiceSchema.parse(await req.json());
    if (!isSandboxServiceId(body.serviceId)) {
      return problemResponse(400, "Validation Error", `Unknown service '${body.serviceId}'.`);
    }

    return await withWebTenantDb(user.tenantId, async (db) => {
      let services;
      try {
        services = await upsertTenantSandboxService(db, user.tenantId, body);
      } catch (err) {
        return problemResponse(
          400,
          "Invalid Service Skills",
          err instanceof Error ? err.message : "Invalid sandbox service configuration."
        );
      }

      const overview = computeAgentCapabilities(services, "overview");
      await db.insert(auditLog).values({
        id: `aud-sbx-${crypto.randomUUID().slice(0, 10)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "sandbox_service_updated",
        toolName: `sandbox.${body.serviceId}`,
        args: {
          serviceId: body.serviceId,
          enabled: body.enabled,
          pinnedToDashboard: body.pinnedToDashboard,
          enabledSkills: body.enabledSkills
        },
        resultHash: "",
        status: "allowed",
        reason: `Updated sandbox configuration for service '${body.serviceId}'`,
        latencyMs: 1
      });

      return NextResponse.json({
        services,
        overviewAgent: {
          scopeId: overview.scopeId,
          agentId: overview.agentId,
          agentName: overview.agentName,
          activeServiceIds: overview.activeServiceIds,
          disabledServiceIds: overview.disabledServiceIds,
          activeSkills: overview.activeSkills.map((s) => s.id)
        }
      });
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
      const services = await upsertTenantSandboxService(db, user.tenantId, {
        serviceId,
        enabled: false,
        pinnedToDashboard: false
      });
      const overview = computeAgentCapabilities(services, "overview");

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

      return NextResponse.json({
        services,
        overviewAgent: {
          scopeId: overview.scopeId,
          agentId: overview.agentId,
          agentName: overview.agentName,
          activeServiceIds: overview.activeServiceIds,
          disabledServiceIds: overview.disabledServiceIds,
          activeSkills: overview.activeSkills.map((s) => s.id)
        }
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
