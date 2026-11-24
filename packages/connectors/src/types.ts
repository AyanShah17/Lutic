import { AsyncLocalStorage } from "node:async_hooks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { Permission, KojoDatabase, SessionUser } from "@kojo/core";

export type ConnectorKind =
  | "cmms"
  | "historian"
  | "mes"
  | "parts-erp"
  | "docs"
  | "paas";

export type ToolkitName =
  | "knowledge"
  | "machine"
  | "maintenance"
  | "analytics"
  | "action"
  | "paas";

export interface ToolExecutionContext {
  db: KojoDatabase;
  user: SessionUser;
  requestId: string;
  conversationId?: string;
  confirmationId?: string;
  idempotencyKey?: string;
}

export const toolContextStorage = new AsyncLocalStorage<ToolExecutionContext>();

export function requireToolContext(): ToolExecutionContext {
  const ctx = toolContextStorage.getStore();
  if (!ctx) {
    throw new Error("ToolExecutionContext missing in AsyncLocalStorage");
  }
  return ctx;
}

export interface ConnectorToolDefinition<
  TSchema extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>
> {
  name: string;
  description: string;
  inputSchema: TSchema;
  requiredPermission: Permission;
  access: "read" | "write";
  toolkit: ToolkitName;
  riskLevel: "low" | "medium" | "high";
  connectorKind: ConnectorKind;
  execute: (
    args: z.infer<TSchema>,
    ctx: ToolExecutionContext
  ) => Promise<Record<string, unknown>>;
}

export interface ConnectorHealth {
  id: string;
  kind: ConnectorKind;
  status: "healthy" | "degraded" | "error";
  latencyMs: number;
  message: string;
}

export interface Connector {
  readonly id: string;
  readonly kind: ConnectorKind;
  readonly name: string;
  readonly credentialSchema: z.ZodObject<z.ZodRawShape>;
  healthCheck(db: KojoDatabase, tenantId: string): Promise<ConnectorHealth>;
  listTools(): ConnectorToolDefinition[];
  createMcpServer(): McpServer;
}

export const MAX_TOOL_ROWS = 50;

export function boundRows<T>(
  rows: T[],
  requestedLimit?: number
): { rows: T[]; truncated: boolean; totalReturned: number; truncationNote?: string } {
  const cap = Math.min(requestedLimit ?? MAX_TOOL_ROWS, MAX_TOOL_ROWS);
  const truncated = rows.length > cap;
  const sliced = rows.slice(0, cap);
  return {
    rows: sliced,
    truncated,
    totalReturned: sliced.length,
    ...(truncated
      ? {
          truncationNote: `Result bounded to ${cap} rows (more records exist; narrow filters to see specific items).`
        }
      : {})
  };
}

export function buildConnectorMcpServer(
  name: string,
  tools: ConnectorToolDefinition[]
): McpServer {
  const server = new McpServer({
    name: `kojo-${name}`,
    version: "0.1.0"
  });

  const registrar = server as unknown as {
    registerTool: (
      toolName: string,
      config: { title?: string; description?: string; inputSchema?: unknown },
      cb: (rawArgs: Record<string, unknown>) => Promise<{
        content: Array<{ type: "text"; text: string }>;
      }>
    ) => void;
  };

  for (const toolDef of tools) {
    registrar.registerTool(
      toolDef.name,
      {
        title: toolDef.name,
        description: toolDef.description,
        inputSchema: toolDef.inputSchema
      },
      async (rawArgs: Record<string, unknown>) => {
        const ctx = requireToolContext();
        const parsed = toolDef.inputSchema.parse(rawArgs ?? {});
        const result = await toolDef.execute(parsed, ctx);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result)
            }
          ]
        };
      }
    );
  }

  return server;
}
