import { NextResponse } from "next/server";
import {
  and,
  authorize,
  desc,
  eq,
  workflowRuns,
  workflows
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { getSessionUser, handleApiError, problemResponse } from "@/lib/auth";

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

      const runs = await db
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.workflowId, params.id),
            eq(workflowRuns.tenantId, user.tenantId)
          )
        )
        .orderBy(desc(workflowRuns.startedAt))
        .limit(25);

      return NextResponse.json({ runs });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
