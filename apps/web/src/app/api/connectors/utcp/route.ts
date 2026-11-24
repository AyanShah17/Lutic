import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorize,
  connectorConnections,
  desc,
  eq,
  getLocalConnectorKind
} from "@kojo/core";
import { defaultMcpRegistry } from "@kojo/connectors";
import { getAllowedToolsForUser } from "@kojo/agent";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { getSessionUser, handleApiError, problemResponse } from "@/lib/auth";

function zodToSchemaObj(schema: unknown): Record<string, unknown> {
  const fn = (z as unknown as { toJSONSchema?: (s: unknown) => Record<string, unknown> }).toJSONSchema;
  if (typeof fn === "function") {
    try {
      return fn(schema);
    } catch {
      // Fallback for non-JSON-representable shapes
    }
  }
  return { type: "object" };
}

/**
 * Exposes an authenticated UTCP 1.0 manual combining authorized Kojo MCP tools and
 * registered remote MCP / UTCP / Kojo protocol connectors for external UTCP clients.
 */
export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "connector:read", { tenantId: user.tenantId });

    const reqOrigin = new URL(req.url).origin;

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [allowedTools, conns] = await Promise.all([
        getAllowedToolsForUser(db, user, defaultMcpRegistry),
        db
          .select()
          .from(connectorConnections)
          .where(eq(connectorConnections.tenantId, user.tenantId))
          .orderBy(desc(connectorConnections.updatedAt))
      ]);

      const localConnByKind = new Map<string, string>();
      for (const c of conns) {
        const k = getLocalConnectorKind(c);
        if (k && !localConnByKind.has(k)) localConnByKind.set(k, c.id);
      }

      const utcpTools: Array<Record<string, unknown>> = allowedTools.map((tool) => {
        const targetConnId = localConnByKind.get(tool.connectorKind) ?? `conn-hub-${tool.connectorKind}`;
        return {
          name: tool.name,
          description: tool.description,
          inputs: zodToSchemaObj(tool.inputSchema),
          tags: [tool.toolkit, tool.connectorKind, tool.access],
          tool_call_template: {
            call_template_type: "http",
            http_method: "POST",
            url: `${reqOrigin}/api/connectors/${targetConnId}/invoke`,
            content_type: "application/json",
            body_template: { toolName: tool.name, args: "$inputs" }
          }
        };
      });

      for (const c of conns) {
        if (c.transport !== "remote_mcp" && c.transport !== "utcp_http") continue;
        for (const t of c.discoveredTools ?? []) {
          const name = typeof t.name === "string" ? t.name : "";
          if (!name) continue;
          utcpTools.push({
            name: `${c.slug}.${name}`,
            description: typeof t.description === "string" ? t.description : `${c.name}: ${name}`,
            inputs:
              t.inputSchema && typeof t.inputSchema === "object"
                ? t.inputSchema
                : { type: "object" },
            tags: [c.slug, c.transport, c.category],
            tool_call_template:
              t.callTemplate && typeof t.callTemplate === "object"
                ? { call_template_type: "http", ...(t.callTemplate as Record<string, unknown>) }
                : {
                    call_template_type: "http",
                    http_method: "POST",
                    url: `${reqOrigin}/api/connectors/${c.id}/invoke`,
                    content_type: "application/json",
                    body_template: { toolName: name, args: "$inputs" }
                  }
          });
        }
      }

      return NextResponse.json({
        manual_version: "1.0.0",
        utcp_version: "1.0.0",
        protocol: "kojo-connector-v1",
        tenantId: user.tenantId,
        tools: utcpTools
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
