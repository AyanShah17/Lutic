import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  auditLog,
  authorize,
  desc,
  eq,
  pruneWorkflowVersions,
  WorkflowDefinitionSchema,
  WorkflowEdgeSchema,
  WorkflowNodeSchema,
  workflows,
  workflowVersions
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";
import { serializeWorkflow } from "@/lib/serializers";

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(600).optional(),
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
  edges: z.array(WorkflowEdgeSchema).optional(),
  enabled: z.boolean().optional(),
  changeSummary: z.string().max(240).optional().default("Updated workflow")
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "workflow:read", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const [wfRows, versionRows] = await Promise.all([
        db
          .select()
          .from(workflows)
          .where(
            and(
              eq(workflows.id, params.id),
              eq(workflows.tenantId, user.tenantId)
            )
          )
          .limit(1),
        db
          .select()
          .from(workflowVersions)
          .where(
            and(
              eq(workflowVersions.workflowId, params.id),
              eq(workflowVersions.tenantId, user.tenantId)
            )
          )
          .orderBy(desc(workflowVersions.version))
          .limit(5)
      ]);

      const wf = wfRows[0];
      if (!wf) {
        return problemResponse(404, "Not Found", "Workflow not found.");
      }

      return NextResponse.json({
        workflow: serializeWorkflow(wf),
        versions: versionRows
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "workflow:write", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const existingRows = await db
        .select()
        .from(workflows)
        .where(
          and(
            eq(workflows.id, params.id),
            eq(workflows.tenantId, user.tenantId)
          )
        )
        .limit(1);

      const existing = existingRows[0];
      if (!existing) {
        return problemResponse(404, "Not Found", "Workflow not found.");
      }

      const body = UpdateWorkflowSchema.parse(await req.json());
      const nextVersion = existing.currentVersion + 1;

      const existingDef = existing.definition as { nodes?: unknown[]; edges?: unknown[] };
      const nextDef = WorkflowDefinitionSchema.parse(
        body.definition ?? {
          nodes: body.nodes ?? existingDef.nodes ?? [],
          edges: body.edges ?? existingDef.edges ?? []
        }
      );

      const nextTriggerType =
        body.triggerType ?? body.trigger?.type ?? existing.triggerType;
      const nextTriggerConfig =
        body.triggerConfig ??
        (body.trigger ? { ...body.trigger } : existing.triggerConfig);

      const now = new Date();
      await db
        .update(workflows)
        .set({
          name: body.name?.trim() ?? existing.name,
          description: body.description ?? existing.description,
          triggerType: nextTriggerType,
          triggerConfig: nextTriggerConfig,
          definition: nextDef as unknown as Record<string, unknown>,
          enabled: body.enabled ?? existing.enabled,
          currentVersion: nextVersion,
          updatedAt: now
        })
        .where(eq(workflows.id, existing.id));

      await db.insert(workflowVersions).values({
        id: `wfv-${existing.id}-v${nextVersion}-${crypto.randomUUID().slice(0, 4)}`,
        tenantId: user.tenantId,
        workflowId: existing.id,
        version: nextVersion,
        definition: nextDef as unknown as Record<string, unknown>,
        changeSummary: body.changeSummary,
        createdBy: user.userId
      });

      await pruneWorkflowVersions(db, existing.id, user.tenantId, 5);

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "workflow_update",
        toolName: "workflows.update",
        args: { workflowId: existing.id, version: nextVersion },
        resultHash: "",
        status: "allowed",
        reason: body.changeSummary,
        latencyMs: 1
      });

      const [updatedRows, versions] = await Promise.all([
        db.select().from(workflows).where(eq(workflows.id, existing.id)).limit(1),
        db
          .select()
          .from(workflowVersions)
          .where(
            and(
              eq(workflowVersions.workflowId, existing.id),
              eq(workflowVersions.tenantId, user.tenantId)
            )
          )
          .orderBy(desc(workflowVersions.version))
          .limit(5)
      ]);

      return NextResponse.json({
        workflow: serializeWorkflow(updatedRows[0]!),
        version: nextVersion,
        versions
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "workflow:write", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const existing = await db
        .select({ id: workflows.id })
        .from(workflows)
        .where(
          and(
            eq(workflows.id, params.id),
            eq(workflows.tenantId, user.tenantId)
          )
        )
        .limit(1);

      if (!existing[0]) {
        return problemResponse(404, "Not Found", "Workflow not found.");
      }

      await db
        .delete(workflows)
        .where(
          and(
            eq(workflows.id, params.id),
            eq(workflows.tenantId, user.tenantId)
          )
        );

      return NextResponse.json({ ok: true, id: params.id });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
