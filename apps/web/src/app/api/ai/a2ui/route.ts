import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  A2UISpecSchema,
  alarms,
  and,
  assets,
  auditLog,
  boardIssues,
  buildA2UIFromPrompt,
  connectorConnections,
  desc,
  eq,
  getTenantSandboxServices,
  getTenantWorkspaceProfile,
  inArray,
  isNull,
  machineStatus,
  saveTenantWorkspaceProfile,
  workflows,
  type SandboxServiceId
} from "@lutic/core";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { enforceApiQuota, isInternalConnectorRow } from "@/lib/quota";

const GenerateBodySchema = z.object({
  action: z.literal("generate").optional().default("generate"),
  prompt: z.string().trim().min(2).max(500),
  pin: z.boolean().optional().default(false)
});

const PinBodySchema = z.object({
  action: z.literal("pin"),
  spec: A2UISpecSchema
});

const UnpinBodySchema = z.object({
  action: z.literal("unpin"),
  specId: z.string().min(1).max(80)
});

const RequestBodySchema = z.union([
  PinBodySchema,
  UnpinBodySchema,
  GenerateBodySchema
]);

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) {
      return problemResponse(401, "Unauthorized", "Please sign in.");
    }

    return await withWebTenantDb(user.tenantId, async (db) => {
      const profile = await getTenantWorkspaceProfile(db, user.tenantId);
      return NextResponse.json({ pinnedA2UI: profile.pinnedA2UI });
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
      return problemResponse(401, "Unauthorized", "Please sign in.");
    }

    const body = RequestBodySchema.parse(await req.json());

    return await withWebTenantDb(user.tenantId, async (db) => {
      const quotaErr = await enforceApiQuota(
        req,
        db,
        user,
        body.action === "generate" ? "ai" : "api"
      );
      if (quotaErr) return quotaErr;

      if (body.action === "pin") {
        const profile = await saveTenantWorkspaceProfile(db, user.tenantId, (cur) => ({
          ...cur,
          pinnedA2UI: [
            body.spec,
            ...cur.pinnedA2UI.filter((item) => item.id !== body.spec.id)
          ].slice(0, 6)
        }));
        return NextResponse.json({ pinnedA2UI: profile.pinnedA2UI });
      }

      if (body.action === "unpin") {
        const profile = await saveTenantWorkspaceProfile(db, user.tenantId, (cur) => ({
          ...cur,
          pinnedA2UI: cur.pinnedA2UI.filter((item) => item.id !== body.specId)
        }));
        return NextResponse.json({ pinnedA2UI: profile.pinnedA2UI });
      }

      const [services, machineRows, alarmRows, workflowRows, issueRows, connRows] =
        await Promise.all([
          getTenantSandboxServices(db, user.tenantId),
          user.plantIds.length > 0
            ? db
                .select({
                  id: assets.id,
                  name: assets.name,
                  status: machineStatus.status
                })
                .from(assets)
                .leftJoin(machineStatus, eq(machineStatus.machineId, assets.id))
                .where(
                  and(
                    eq(assets.tenantId, user.tenantId),
                    eq(assets.type, "machine"),
                    inArray(assets.plantId, user.plantIds)
                  )
                )
                .limit(25)
            : Promise.resolve([]),
          user.plantIds.length > 0
            ? db
                .select({
                  id: alarms.id,
                  code: alarms.code,
                  machineId: alarms.machineId,
                  message: alarms.message,
                  severity: alarms.severity
                })
                .from(alarms)
                .where(
                  and(
                    eq(alarms.tenantId, user.tenantId),
                    inArray(alarms.plantId, user.plantIds),
                    isNull(alarms.clearedAt)
                  )
                )
                .limit(12)
            : Promise.resolve([]),
          db
            .select({
              id: workflows.id,
              name: workflows.name,
              enabled: workflows.enabled,
              triggerType: workflows.triggerType
            })
            .from(workflows)
            .where(eq(workflows.tenantId, user.tenantId))
            .orderBy(desc(workflows.updatedAt))
            .limit(10),
          db
            .select({
              identifier: boardIssues.identifier,
              title: boardIssues.title,
              status: boardIssues.status,
              priority: boardIssues.priority
            })
            .from(boardIssues)
            .where(eq(boardIssues.tenantId, user.tenantId))
            .orderBy(desc(boardIssues.updatedAt))
            .limit(12),
          db
            .select({
              id: connectorConnections.id,
              name: connectorConnections.name,
              status: connectorConnections.status,
              category: connectorConnections.category,
              transport: connectorConnections.transport,
              slug: connectorConnections.slug
            })
            .from(connectorConnections)
            .where(eq(connectorConnections.tenantId, user.tenantId))
            .limit(20)
        ]);

      const activeServiceIds = services
        .filter((s) => s.enabled)
        .map((s) => s.id as SandboxServiceId);
      const activeSet = new Set(activeServiceIds);

      const spec = buildA2UIFromPrompt({
        prompt: body.prompt,
        activeServiceIds,
        machines: activeSet.has("machines") || activeSet.has("monitoring")
          ? machineRows.map((m) => ({ id: m.id, name: m.name, status: m.status ?? "offline" }))
          : [],
        alarms: activeSet.has("monitoring") || activeSet.has("machines") ? alarmRows : [],
        workflows: activeSet.has("workflows") ? workflowRows : [],
        issues: activeSet.has("board") ? issueRows : [],
        connectors: activeSet.has("connectors")
          ? connRows.filter((c) => !isInternalConnectorRow(c))
          : []
      });

      let profile = await getTenantWorkspaceProfile(db, user.tenantId);
      if (body.pin) {
        profile = await saveTenantWorkspaceProfile(db, user.tenantId, (cur) => ({
          ...cur,
          pinnedA2UI: [
            spec,
            ...cur.pinnedA2UI.filter((item) => item.id !== spec.id)
          ].slice(0, 6)
        }));
      }

      await db.insert(auditLog).values({
        id: `aud-a2ui-${crypto.randomUUID().slice(0, 10)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "a2ui_generated",
        toolName: "ai.a2ui",
        args: { prompt: body.prompt.slice(0, 120), pin: body.pin },
        resultHash: "",
        status: "allowed",
        reason: "Generated declarative A2UI view",
        latencyMs: 1
      });

      return NextResponse.json({
        spec,
        pinnedA2UI: profile.pinnedA2UI
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
