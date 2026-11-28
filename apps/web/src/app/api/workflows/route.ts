import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  auditLog,
  authorize,
  desc,
  eq,
  WorkflowDefinitionSchema,
  WorkflowEdgeSchema,
  WorkflowNodeSchema,
  workflows,
  workflowVersions
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { enforceApiQuota } from "@/lib/quota";
import { serializeWorkflow } from "@/lib/serializers";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(600).optional().default(""),
  plantId: z.string().nullable().optional(),
  trigger: z
    .object({
      type: z.enum(["manual", "schedule", "alert", "connector"]).optional()
    })
    .passthrough()
    .optional(),
  triggerType: z.enum(["manual", "schedule", "alert", "connector"]).optional(),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  definition: WorkflowDefinitionSchema.optional(),
  nodes: z.array(WorkflowNodeSchema).optional(),
  edges: z.array(WorkflowEdgeSchema).optional().default([]),
  enabled: z.boolean().optional().default(true)
});

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "workflow:read", { tenantId: user.tenantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(workflows)
        .where(eq(workflows.tenantId, user.tenantId))
        .orderBy(desc(workflows.updatedAt));

      return NextResponse.json({
        workflows: rows.map(serializeWorkflow)
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
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "workflow:write", { tenantId: user.tenantId });

    const body = CreateWorkflowSchema.parse(await req.json());
    if (body.plantId && !user.plantIds.includes(body.plantId)) {
      return problemResponse(
        403,
        "Forbidden",
        `Plant '${body.plantId}' is outside your authorized plant scope.`
      );
    }

    const definition = WorkflowDefinitionSchema.parse(
      body.definition ?? {
        nodes:
          body.nodes && body.nodes.length > 0
            ? body.nodes
            : [{ id: "n1", type: "trigger", label: "Manual Trigger", config: {} }],
        edges: body.edges ?? []
      }
    );

    const triggerType =
      body.triggerType ?? body.trigger?.type ?? "manual";
    const triggerConfig =
      body.triggerConfig ??
      (body.trigger ? { ...body.trigger } : {});

    const id = `wf-${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date();

    const row = {
      id,
      tenantId: user.tenantId,
      plantId: body.plantId ?? user.plantIds[0] ?? null,
      name: body.name.trim(),
      description: body.description,
      triggerType,
      triggerConfig,
      definition: definition as unknown as Record<string, unknown>,
      enabled: body.enabled,
      currentVersion: 1,
      createdBy: user.userId,
      createdAt: now,
      updatedAt: now
    };

    return await withWebTenantDb(user.tenantId, async (db) => {
      const quotaError = await enforceApiQuota(req, db, user, "api");
      if (quotaError) return quotaError;
      await db.insert(workflows).values(row);
      await db.insert(workflowVersions).values({
        id: `wfv-${id}-v1`,
        tenantId: user.tenantId,
        workflowId: id,
        version: 1,
        definition: definition as unknown as Record<string, unknown>,
        changeSummary: "Initial workflow version",
        createdBy: user.userId
      });

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "workflow_create",
        toolName: "workflows.create",
        args: { workflowId: id, name: row.name },
        resultHash: "",
        status: "allowed",
        reason: "Workflow created",
        latencyMs: 1
      });

      const serialized = serializeWorkflow(row);
      return NextResponse.json(
        { id, workflowId: id, workflow: serialized },
        { status: 201 }
      );
    });
  } catch (err) {
    return handleApiError(err);
  }
}
