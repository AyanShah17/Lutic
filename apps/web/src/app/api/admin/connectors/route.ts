import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  auditLog,
  authorize,
  connectors,
  encryptCredentials,
  eq,
  isDemoMode
} from "@lutic/core";
import { ALL_CONNECTORS, defaultMcpRegistry } from "@lutic/connectors";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const SaveConnectorSchema = z.object({
  kind: z.enum(["cmms", "historian", "mes", "parts-erp", "docs"]),
  name: z.string().min(2).max(120),
  credentials: z.record(z.string(), z.unknown()),
  action: z.enum(["save", "test"]).default("save")
});

type ZodDefLike = {
  type?: string;
  typeName?: string;
  innerType?: { _def?: ZodDefLike };
  defaultValue?: unknown;
};

function extractSchemaFields(schema: z.ZodObject<z.ZodRawShape>) {
  return Object.entries(schema.shape).map(([key, field]) => {
    let cur = (field as unknown as { _def?: ZodDefLike })._def;
    let rawDefault: unknown;
    let hasDefault = false;

    while (cur) {
      if ((cur.type === "default" || cur.typeName === "ZodDefault") && !hasDefault && "defaultValue" in cur) {
        rawDefault = typeof cur.defaultValue === "function" ? cur.defaultValue() : cur.defaultValue;
        hasDefault = true;
      }
      const kind = cur.type ?? cur.typeName;
      if (
        cur.innerType?._def &&
        (kind === "default" || kind === "optional" || kind === "nullable" ||
          kind === "ZodDefault" || kind === "ZodOptional" || kind === "ZodNullable")
      ) {
        cur = cur.innerType._def;
      } else {
        break;
      }
    }

    const kind = cur?.type ?? cur?.typeName ?? "string";
    const fieldType =
      kind === "boolean" || kind === "ZodBoolean"
        ? "boolean"
        : kind === "number" || kind === "ZodNumber"
          ? "number"
          : /secret|token|key|password/i.test(key)
            ? "password"
            : "text";
    return {
      key,
      type: fieldType,
      defaultValue: hasDefault ? (rawDefault ?? "") : ""
    };
  });
}

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "admin:connectors", { tenantId: user.tenantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const rows = await db
        .select({
          id: connectors.id,
          kind: connectors.kind,
          name: connectors.name,
          status: connectors.status,
          lastSyncAt: connectors.lastSyncAt,
          lastError: connectors.lastError,
          config: connectors.config,
          updatedAt: connectors.updatedAt
        })
        .from(connectors)
        .where(eq(connectors.tenantId, user.tenantId));

      const demo = isDemoMode();
      const schemas = ALL_CONNECTORS.map((c) => ({
        kind: c.kind,
        name: demo ? c.name : `Local ${c.kind} tools`,
        fields: demo ? extractSchemaFields(c.credentialSchema) : [],
        tools: c.listTools().map((t) => t.name)
      }));

      return NextResponse.json({
        connectors: demo ? rows : rows.map((row) => row.config?.mode === "local_mcp" ? row : {
          ...row,
          status: "error",
          lastSyncAt: null,
          lastError: "Local MCP adapter requires verification"
        }),
        schemas
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
    authorize(user, "admin:connectors", { tenantId: user.tenantId });

    const body = SaveConnectorSchema.parse(await req.json());
    const connector = ALL_CONNECTORS.find((c) => c.kind === body.kind);
    if (!connector) {
      return problemResponse(404, "Not Found", `Unknown connector '${body.kind}'.`);
    }

    const demo = isDemoMode();
    if (!demo && Object.keys(body.credentials).length > 0) {
      return problemResponse(501, "External connector unavailable", "Only local MCP tools are available for this connector.");
    }
    const validatedCreds = demo ? connector.credentialSchema.parse(body.credentials) : null;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const started = Date.now();
      const health = demo ? await connector.healthCheck(db, user.tenantId) : {
        id: connector.id,
        kind: connector.kind,
        status: (await defaultMcpRegistry.discoverMcpTools(connector.kind)).length > 0 ? "healthy" as const : "error" as const,
        latencyMs: Date.now() - started,
        message: "Local MCP tool discovery completed"
      };
      const config = { mode: demo ? "mock" : "local_mcp", readOnlyByDefault: true };

      if (body.action === "test") {
        await db
          .update(connectors)
          .set({
            status: health.status,
            lastSyncAt: new Date(),
            lastError: health.status === "healthy" ? null : health.message,
            config
          })
          .where(
            and(
              eq(connectors.tenantId, user.tenantId),
              eq(connectors.kind, body.kind)
            )
          );
        return NextResponse.json({ health });
      }

      const encrypted = validatedCreds ? encryptCredentials(validatedCreds) : "";
      const existing = await db
        .select()
        .from(connectors)
        .where(
          and(
            eq(connectors.tenantId, user.tenantId),
            eq(connectors.kind, body.kind)
          )
        )
        .limit(1);

      if (existing[0]) {
        await db
          .update(connectors)
          .set({
            name: body.name,
            encryptedCredentials: encrypted,
            status: health.status,
            lastSyncAt: new Date(),
            config,
            updatedAt: new Date()
          })
          .where(eq(connectors.id, existing[0].id));
      } else {
        await db.insert(connectors).values({
          id: `conn-${crypto.randomUUID().slice(0, 8)}`,
          tenantId: user.tenantId,
          kind: body.kind,
          name: body.name,
          status: health.status,
          lastSyncAt: new Date(),
          encryptedCredentials: encrypted,
          config
        });
      }

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "admin_connector_save",
        toolName: "admin.connectors.save",
        args: { kind: body.kind, name: body.name },
        resultHash: "",
        status: "allowed",
        reason: demo ? "Connector credentials encrypted & saved" : "Local MCP adapter saved",
        latencyMs: health.latencyMs
      });

      return NextResponse.json({ ok: true, health });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
