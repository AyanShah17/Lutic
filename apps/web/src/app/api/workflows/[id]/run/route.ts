import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  authorize,
  eq,
  executeWorkflow,
  workflows
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const RunWorkflowSchema = z.object({
  input: z.record(z.string(), z.unknown()).optional().default({})
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "workflow:execute", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const wfRows = await db
        .select({ id: workflows.id })
        .from(workflows)
        .where(
          and(
            eq(workflows.id, params.id),
            eq(workflows.tenantId, user.tenantId)
          )
        )
        .limit(1);

      if (!wfRows[0]) {
        return problemResponse(404, "Not Found", "Workflow not found.");
      }

      let rawBody: unknown = {};
      try {
        rawBody = await req.json();
      } catch {
        rawBody = {};
      }
      const body = RunWorkflowSchema.parse(rawBody);

      const run = await executeWorkflow(db, {
        tenantId: user.tenantId,
        workflowId: params.id,
        triggerSource: "manual",
        triggeredBy: user.userId,
        input: body.input,
        allowedPlantIds: user.plantIds
      });

      return NextResponse.json({
        id: run.id,
        runId: run.id,
        run
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
