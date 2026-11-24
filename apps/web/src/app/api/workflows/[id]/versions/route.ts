import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  authorize,
  desc,
  eq,
  pruneWorkflowVersions,
  workflows,
  workflowVersions
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";
import { serializeWorkflow } from "@/lib/serializers";

const RestoreSchema = z.object({
  version: z.number().int().min(1)
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
      const versions = await db
        .select()
        .from(workflowVersions)
        .where(
          and(
            eq(workflowVersions.workflowId, params.id),
            eq(workflowVersions.tenantId, user.tenantId)
          )
        )
        .orderBy(desc(workflowVersions.version))
        .limit(5);

      return NextResponse.json({ versions });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "workflow:write", { tenantId: user.tenantId });

    const { version } = RestoreSchema.parse(await req.json());

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const [wfRows, targetRows] = await Promise.all([
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
              eq(workflowVersions.tenantId, user.tenantId),
              eq(workflowVersions.version, version)
            )
          )
          .limit(1)
      ]);

      const wf = wfRows[0];
      const target = targetRows[0];
      if (!wf || !target) {
        return problemResponse(404, "Not Found", "Workflow or version not found.");
      }

      const nextVersion = wf.currentVersion + 1;
      await db
        .update(workflows)
        .set({
          definition: target.definition,
          currentVersion: nextVersion,
          updatedAt: new Date()
        })
        .where(eq(workflows.id, wf.id));

      await db.insert(workflowVersions).values({
        id: `wfv-${wf.id}-v${nextVersion}-${crypto.randomUUID().slice(0, 4)}`,
        tenantId: user.tenantId,
        workflowId: wf.id,
        version: nextVersion,
        definition: target.definition,
        changeSummary: `Restored from v${version}`,
        createdBy: user.userId
      });

      await pruneWorkflowVersions(db, wf.id, user.tenantId, 5);

      const [updatedRows, versions] = await Promise.all([
        db.select().from(workflows).where(eq(workflows.id, wf.id)).limit(1),
        db
          .select()
          .from(workflowVersions)
          .where(
            and(
              eq(workflowVersions.workflowId, wf.id),
              eq(workflowVersions.tenantId, user.tenantId)
            )
          )
          .orderBy(desc(workflowVersions.version))
          .limit(5)
      ]);

      return NextResponse.json({
        version: nextVersion,
        workflow: serializeWorkflow(updatedRows[0]!),
        versions
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
