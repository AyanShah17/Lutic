import { NextResponse } from "next/server";
import {
  and,
  asc,
  assets,
  AuthorizationError,
  authorize,
  conversations,
  eq,
  inArray,
  messages,
  userPlants
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { getSessionUser, handleApiError, problemResponse } from "@/lib/auth";

/**
 * Shared read-only conversation view scoped strictly to the same tenant and plant(s).
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) {
      return problemResponse(401, "Unauthorized", "Sign in to view shared tenant conversation.");
    }
    authorize(user, "docs:read", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const convRows = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.shareToken, params.token),
            eq(conversations.tenantId, user.tenantId)
          )
        )
        .limit(1);

      const conv = convRows[0];
      if (!conv) {
        return problemResponse(404, "Not Found", "Shared conversation not found in your tenant.");
      }

      const msgRows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conv.id),
            eq(messages.tenantId, user.tenantId)
          )
        )
        .orderBy(asc(messages.createdAt));

      const referencedMachineIds = new Set<string>();
      const requiredPlantIds = new Set<string>();
      if (conv.machineId) referencedMachineIds.add(conv.machineId);

      for (const msg of msgRows) {
        for (const tc of msg.toolCalls ?? []) {
          const args = tc && typeof tc === "object" && tc.args && typeof tc.args === "object"
            ? (tc.args as Record<string, unknown>)
            : null;
          if (!args) continue;
          if (typeof args.machineId === "string" && args.machineId.trim()) {
            referencedMachineIds.add(args.machineId.trim());
          }
          if (typeof args.plantId === "string" && args.plantId.trim()) {
            requiredPlantIds.add(args.plantId.trim());
          }
          if (Array.isArray(args.plantIds)) {
            for (const pid of args.plantIds) {
              if (typeof pid === "string" && pid.trim()) {
                requiredPlantIds.add(pid.trim());
              }
            }
          }
        }
      }

      if (referencedMachineIds.size > 0) {
        const machineIds = [...referencedMachineIds];
        const foundMachines = await db
          .select({ id: assets.id, plantId: assets.plantId })
          .from(assets)
          .where(and(inArray(assets.id, machineIds), eq(assets.tenantId, user.tenantId)));
        if (foundMachines.length !== machineIds.length) {
          return problemResponse(404, "Not Found", "Shared conversation asset is unavailable.");
        }
        for (const machine of foundMachines) {
          requiredPlantIds.add(machine.plantId);
        }
      }

      if (!conv.machineId) {
        const creatorPlants = await db
          .select({ plantId: userPlants.plantId })
          .from(userPlants)
          .where(and(eq(userPlants.userId, conv.userId), eq(userPlants.tenantId, user.tenantId)));
        if (creatorPlants.length === 0 && requiredPlantIds.size === 0) {
          throw new AuthorizationError("Shared conversation has no verifiable plant scope.");
        }
        for (const p of creatorPlants) {
          requiredPlantIds.add(p.plantId);
        }
      }

      const plantList = [...requiredPlantIds];
      if (plantList.length === 0) {
        throw new AuthorizationError("Shared conversation has no verifiable plant scope.");
      }

      authorize(user, conv.machineId ? "machine:read" : "docs:read", {
        tenantId: user.tenantId,
        plantIds: plantList
      });

      return NextResponse.json({
        readOnly: true,
        conversation: conv,
        messages: msgRows
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
