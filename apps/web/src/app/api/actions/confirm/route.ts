import { NextResponse } from "next/server";
import {
  and,
  authorize,
  eq,
  pendingActions,
} from "@lutic/core";
import {
  ConfirmationInputSchema,
  executeToolWithPolicy
} from "@lutic/agent";
import { defaultMcpRegistry } from "@lutic/connectors";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { enforceApiQuota } from "@/lib/quota";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");

    const body = ConfirmationInputSchema.parse(await req.json());

    return await withWebTenantDb(user.tenantId, async (db) => {
      const quotaErr = await enforceApiQuota(req, db, user, "api");
      if (quotaErr) return quotaErr;

      const rows = await db
        .select()
        .from(pendingActions)
        .where(
          and(
            eq(pendingActions.id, body.actionId),
            eq(pendingActions.tenantId, user.tenantId),
            eq(pendingActions.userId, user.userId)
          )
        )
        .limit(1);

      const action = rows[0];
      if (!action) {
        return problemResponse(404, "Not Found", "Pending action not found for your account.");
      }

      const toolDef = defaultMcpRegistry.getToolDefinition(action.toolName);
      const requiredPerm =
        toolDef?.requiredPermission ??
        (action.toolName === "reserve_part" ? "parts:write" : "workorder:write");
      authorize(user, requiredPerm, {
        tenantId: action.tenantId
      });

      if (action.idempotencyKey !== body.idempotencyKey) {
        return problemResponse(409, "Conflict", "Idempotency key mismatch.");
      }

      if (body.decision === "cancel") {
        await db
          .update(pendingActions)
          .set({ status: "cancelled", confirmedAt: new Date() })
          .where(eq(pendingActions.id, action.id));
        return NextResponse.json({ status: "cancelled", actionId: action.id });
      }

      if (action.status === "executed" && action.result) {
        return NextResponse.json({
          status: "executed",
          idempotentReplay: true,
          actionId: action.id,
          result: action.result
        });
      }

      const policyRes = await executeToolWithPolicy(
        action.toolName,
        action.args,
        {
          db,
          user,
          requestId: `confirm-${action.id}`,
          conversationId: action.conversationId ?? undefined,
          confirmationId: action.id,
          idempotencyKey: action.idempotencyKey
        }
      );

      if (policyRes.status === "denied" || policyRes.status === "error") {
        return problemResponse(
          policyRes.status === "denied" ? 403 : 400,
          "Action Failed",
          policyRes.denialReason ?? "Unable to execute action"
        );
      }

      await db
        .update(pendingActions)
        .set({
          status: "executed",
          confirmedAt: new Date(),
          result: policyRes.data ?? {}
        })
        .where(eq(pendingActions.id, action.id));

      return NextResponse.json({
        status: "executed",
        idempotentReplay: false,
        actionId: action.id,
        result: policyRes.data
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
