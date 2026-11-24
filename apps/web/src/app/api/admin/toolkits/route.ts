import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  auditLog,
  authorize,
  eq,
  RoleSchema,
  roleToolkits,
  toolkits,
  toolkitTools
} from "@kojo/core";
import { defaultMcpRegistry } from "@kojo/connectors";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const PatchToolkitSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("role_toolkit"),
    role: RoleSchema,
    toolkitId: z.string().min(1),
    enabled: z.boolean()
  }),
  z.object({
    mode: z.literal("toolkit_tool"),
    toolkitId: z.string().min(1),
    toolName: z.string().min(1),
    enabled: z.boolean()
  })
]);

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "admin:toolkits", { tenantId: user.tenantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [tkRows, ttRows, rtRows] = await Promise.all([
        db.select().from(toolkits).where(eq(toolkits.tenantId, user.tenantId)),
        db.select().from(toolkitTools).where(eq(toolkitTools.tenantId, user.tenantId)),
        db.select().from(roleToolkits).where(eq(roleToolkits.tenantId, user.tenantId))
      ]);

      const toolMetaMap = new Map(
        defaultMcpRegistry.listToolDefinitions().map((t) => [
          t.name,
          {
            description: t.description,
            requiredPermission: t.requiredPermission,
            access: t.access,
            riskLevel: t.riskLevel,
            connectorKind: t.connectorKind
          }
        ])
      );

      return NextResponse.json({
        toolkits: tkRows.map((tk) => ({
          ...tk,
          tools: ttRows
            .filter((tt) => tt.toolkitId === tk.id)
            .map((tt) => ({
              ...tt,
              meta: toolMetaMap.get(tt.toolName) ?? null
            }))
        })),
        roleToolkits: rtRows
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "admin:toolkits", { tenantId: user.tenantId });

    const body = PatchToolkitSchema.parse(await req.json());

    return await withWebTenantDb(user.tenantId, async (db) => {
      if (body.mode === "role_toolkit") {
        const existing = await db
          .select()
          .from(roleToolkits)
          .where(
            and(
              eq(roleToolkits.tenantId, user.tenantId),
              eq(roleToolkits.role, body.role),
              eq(roleToolkits.toolkitId, body.toolkitId)
            )
          )
          .limit(1);

        if (existing[0]) {
          await db
            .update(roleToolkits)
            .set({ enabled: body.enabled })
            .where(eq(roleToolkits.id, existing[0].id));
        } else {
          await db.insert(roleToolkits).values({
            id: `rt-${body.role}-${body.toolkitId}-${crypto.randomUUID().slice(0, 4)}`,
            tenantId: user.tenantId,
            role: body.role,
            toolkitId: body.toolkitId,
            enabled: body.enabled
          });
        }
      } else {
        await db
          .update(toolkitTools)
          .set({ enabled: body.enabled })
          .where(
            and(
              eq(toolkitTools.tenantId, user.tenantId),
              eq(toolkitTools.toolkitId, body.toolkitId),
              eq(toolkitTools.toolName, body.toolName)
            )
          );
      }

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "admin_toolkit_change",
        toolName: "admin.toolkits.update",
        args: body,
        resultHash: "",
        status: "allowed",
        reason: "Live toolkit policy updated",
        latencyMs: 1
      });

      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
