import { z } from "zod";
import {
  and,
  assets,
  auditLog,
  authorize,
  consumeRateLimit,
  eq,
  isCodeModeEnabled,
  pendingActions,
  roleToolkits,
  sha256Hex,
  sql,
  toolkitTools,
  toolkits,
  type LuticDatabase,
  type RateLimitConsumer,
  type SessionUser
} from "@lutic/core";
import {
  defaultMcpRegistry,
  type ConnectorToolDefinition,
  type McpToolRegistry,
  type ToolExecutionContext
} from "@lutic/connectors";
import crypto from "node:crypto";
import { executeLuticConnectorCode } from "./code-mode";

export interface PolicyEvaluationResult {
  status: "allowed" | "denied" | "requires_confirmation" | "confirmed" | "error";
  toolName: string;
  data?: Record<string, unknown>;
  untrustedWrappedText?: string;
  pendingAction?: {
    id: string;
    toolName: string;
    args: Record<string, unknown>;
    summary: string;
    idempotencyKey: string;
  };
  denialReason?: string;
  latencyMs: number;
}

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_USER_RATE_LIMIT = 120;
export const DEFAULT_TENANT_RATE_LIMIT = 600;

export async function resetRateLimits(db: LuticDatabase): Promise<void> {
  await db.execute(sql`DELETE FROM rate_limits WHERE scope IN ('mcp-user', 'mcp-tenant')`);
}

export function wrapUntrustedToolResult(
  toolName: string,
  payload: unknown
): string {
  const json = JSON.stringify(payload, null, 2);
  return `<untrusted_tool_result tool="${toolName}">\n${json}\n</untrusted_tool_result>`;
}

/**
 * Fetches live enabled tool names for a role in the user's tenant directly from Postgres.
 * Admin Console changes to role_toolkits or toolkit_tools take effect on the very next call.
 */
export async function getAllowedToolsForUser(
  db: LuticDatabase,
  user: SessionUser,
  registry: McpToolRegistry = defaultMcpRegistry
): Promise<ConnectorToolDefinition[]> {
  const rows = await db
    .select({
      toolName: toolkitTools.toolName,
      toolkitName: toolkits.name,
      toolEnabled: toolkitTools.enabled,
      roleEnabled: roleToolkits.enabled
    })
    .from(roleToolkits)
    .innerJoin(toolkits, eq(toolkits.id, roleToolkits.toolkitId))
    .innerJoin(toolkitTools, eq(toolkitTools.toolkitId, toolkits.id))
    .where(
      and(
        eq(roleToolkits.tenantId, user.tenantId),
        eq(roleToolkits.role, user.role)
      )
    );

  const enabledNames = new Set(
    rows
      .filter((r) => r.roleEnabled && r.toolEnabled)
      .map((r) => r.toolName)
  );

  return registry
    .listToolDefinitions()
    .filter(
      (def) => enabledNames.has(def.name) &&
        (def.name !== "execute_connector_code" || isCodeModeEnabled())
    );
}

async function writeAuditEntry(
  db: LuticDatabase,
  entry: {
    tenantId: string;
    userId: string;
    role: string;
    conversationId?: string;
    action: string;
    toolName: string;
    args: Record<string, unknown>;
    resultHash: string;
    status: "allowed" | "denied" | "confirmed" | "error";
    reason: string;
    latencyMs: number;
  }
): Promise<void> {
  await db.insert(auditLog).values({
    id: `aud-${crypto.randomUUID().slice(0, 12)}`,
    tenantId: entry.tenantId,
    userId: entry.userId,
    role: entry.role,
    conversationId: entry.conversationId ?? null,
    action: entry.action,
    toolName: entry.toolName,
    args: entry.args,
    resultHash: entry.resultHash,
    status: entry.status,
    reason: entry.reason,
    latencyMs: entry.latencyMs
  });
}

function summarizeWriteAction(
  toolName: string,
  args: Record<string, unknown>
): string {
  if (toolName === "draft_work_order") {
    return `Create ${String(args.priority ?? "high")} ${String(args.type ?? "corrective")} work order on machine ${String(args.machineId)}${args.faultCode ? ` (fault ${String(args.faultCode)})` : ""}: "${String(args.description ?? "")}"`;
  }
  if (toolName === "reserve_part") {
    return `Reserve ${String(args.quantity ?? 1)}x part ${String(args.partNo)} at plant ${String(args.plantId ?? "assigned plant")}`;
  }
  if (toolName === "paas.trigger_workflow") {
    return `Execute workflow ${String(args.workflowId)}`;
  }
  if (toolName === "paas.acknowledge_alert") {
    return `Acknowledge alert event ${String(args.alertId)}`;
  }
  if (toolName === "paas.publish_notification") {
    return `Publish notification "${String(args.subject ?? "")}" to topic ${String(args.topicId ?? "topic-plant-alerts")}`;
  }
  return `Execute write tool ${toolName}`;
}

export interface PolicyCheckOptions {
  registry?: McpToolRegistry;
  userRateLimit?: number;
  tenantRateLimit?: number;
  consumeQuota?: RateLimitConsumer;
  allowedToolNamesOverride?: ReadonlySet<string>;
  serviceScopeLabel?: string;
}

/**
 * 6-Step Deterministic Policy Engine executed in code before every MCP tool call.
 */
export async function executeToolWithPolicy(
  toolName: string,
  rawArgs: Record<string, unknown>,
  ctx: ToolExecutionContext,
  options: PolicyCheckOptions = {}
): Promise<PolicyEvaluationResult> {
  const started = Date.now();
  const registry = options.registry ?? defaultMcpRegistry;
  const def = registry.getToolDefinition(toolName);

  const deny = async (reason: string): Promise<PolicyEvaluationResult> => {
    const latencyMs = Date.now() - started;
    await writeAuditEntry(ctx.db, {
      tenantId: ctx.user.tenantId,
      userId: ctx.user.userId,
      role: ctx.user.role,
      conversationId: ctx.conversationId,
      action: "tool_call",
      toolName,
      args: rawArgs,
      resultHash: "",
      status: "denied",
      reason,
      latencyMs
    });
    return {
      status: "denied",
      toolName,
      denialReason: reason,
      latencyMs
    };
  };

  if (!def) {
    return deny(`Unknown tool '${toolName}'.`);
  }

  // Step 1: Check live toolkit & tool membership for caller's role in DB
  const allowedTools = await getAllowedToolsForUser(ctx.db, ctx.user, registry);
  const isInRoleToolkit = allowedTools.some((t) => t.name === toolName);
  if (!isInRoleToolkit) {
    return deny(
      `Tool '${toolName}' is not enabled in any toolkit assigned to role '${ctx.user.role}'.`
    );
  }

  // Step 1b: Enforce strict per-service / sandbox agent boundary when scoped to a service agent
  if (options.allowedToolNamesOverride && !options.allowedToolNamesOverride.has(toolName)) {
    return deny(
      `Tool '${toolName}' is not permitted for ${options.serviceScopeLabel ?? "this service agent"}. Only skills belonging to this service can execute here; switch to the Overview Agent for cross-service actions.`
    );
  }

  // Step 2: Check RBAC permission via single authorize() function
  try {
    authorize(ctx.user, def.requiredPermission, {
      tenantId: ctx.user.tenantId
    });
  } catch (err) {
    return deny(err instanceof Error ? err.message : "Permission denied");
  }

  // Step 3: Enforce plant and machine scope from session (never trust model arguments)
  const requestedPlantId =
    typeof rawArgs.plantId === "string" && rawArgs.plantId.trim() !== ""
      ? rawArgs.plantId
      : typeof (rawArgs.filters as Record<string, unknown> | undefined)?.plantId ===
            "string"
        ? String((rawArgs.filters as Record<string, unknown>).plantId)
        : undefined;

  if (requestedPlantId && !ctx.user.plantIds.includes(requestedPlantId)) {
    return deny(
      `Plant '${requestedPlantId}' is outside your authorized plant scope (${ctx.user.plantIds.join(", ")}).`
    );
  }

  const requestedMachineId =
    typeof rawArgs.machineId === "string" && rawArgs.machineId.trim() !== ""
      ? rawArgs.machineId
      : typeof (rawArgs.filters as Record<string, unknown> | undefined)?.machineId ===
            "string"
        ? String((rawArgs.filters as Record<string, unknown>).machineId)
        : undefined;

  if (requestedMachineId) {
    const mRows = await ctx.db
      .select({ id: assets.id, plantId: assets.plantId, tenantId: assets.tenantId })
      .from(assets)
      .where(
        and(
          eq(assets.id, requestedMachineId),
          eq(assets.tenantId, ctx.user.tenantId)
        )
      )
      .limit(1);

    const machine = mRows[0];
    if (!machine) {
      return deny(
        `Machine '${requestedMachineId}' does not exist in your tenant.`
      );
    }
    if (!ctx.user.plantIds.includes(machine.plantId)) {
      return deny(
        `Machine '${requestedMachineId}' belongs to plant '${machine.plantId}', which is outside your plant scope.`
      );
    }
  }

  // Step 4: Zod schema validation
  const parsed = def.inputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issueMsg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
      .join("; ");
    return deny(`Invalid arguments for '${toolName}': ${issueMsg}`);
  }

  // Step 5: Write tool confirmation & idempotency gate
  if (def.access === "write") {
    if (!ctx.confirmationId || !ctx.idempotencyKey) {
      const pendingId = `act-${crypto.randomUUID().slice(0, 10)}`;
      const idempotencyKey = `idemp-${crypto.randomUUID()}`;
      const argsObj = parsed.data as Record<string, unknown>;
      // Inject session plantId if reserve_part omitted it
      if (toolName === "reserve_part" && !argsObj.plantId && ctx.user.plantIds[0]) {
        argsObj.plantId = ctx.user.plantIds[0];
      }
      const summary = summarizeWriteAction(toolName, argsObj);
      await ctx.db.insert(pendingActions).values({
        id: pendingId,
        tenantId: ctx.user.tenantId,
        userId: ctx.user.userId,
        conversationId: ctx.conversationId ?? null,
        toolName,
        args: argsObj,
        summary,
        status: "pending",
        idempotencyKey
      });

      const latencyMs = Date.now() - started;
      await writeAuditEntry(ctx.db, {
        tenantId: ctx.user.tenantId,
        userId: ctx.user.userId,
        role: ctx.user.role,
        conversationId: ctx.conversationId,
        action: "write_proposed",
        toolName,
        args: argsObj,
        resultHash: sha256Hex(summary),
        status: "allowed",
        reason: "Pending explicit user confirmation",
        latencyMs
      });

      return {
        status: "requires_confirmation",
        toolName,
        pendingAction: {
          id: pendingId,
          toolName,
          args: argsObj,
          summary,
          idempotencyKey
        },
        latencyMs
      };
    }

    // Verify confirmed pending action belongs to this user and tenant
    const pendingRows = await ctx.db
      .select()
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.id, ctx.confirmationId),
          eq(pendingActions.tenantId, ctx.user.tenantId),
          eq(pendingActions.userId, ctx.user.userId)
        )
      )
      .limit(1);

    const pending = pendingRows[0];
    if (!pending) {
      return deny("Confirmation record not found for current user.");
    }
    if (pending.status === "cancelled") {
      return deny("Action was cancelled by the user.");
    }
    if (pending.idempotencyKey !== ctx.idempotencyKey) {
      return deny("Idempotency key mismatch for confirmed action.");
    }
  }

  // Step 6: Rate limits per user and per tenant
  const consumeQuota: RateLimitConsumer = options.consumeQuota ?? ((bucket) => consumeRateLimit(ctx.db, bucket));
  const userOk = await consumeQuota({
    scope: "mcp-user",
    key: JSON.stringify([ctx.user.tenantId, ctx.user.userId]),
    limit: options.userRateLimit ?? DEFAULT_USER_RATE_LIMIT,
    windowMs: RATE_LIMIT_WINDOW_MS
  });
  if (!userOk) {
    return deny("Per-user tool execution rate limit exceeded. Please wait a moment.");
  }
  const tenantOk = await consumeQuota({
    scope: "mcp-tenant",
    key: ctx.user.tenantId,
    limit: options.tenantRateLimit ?? DEFAULT_TENANT_RATE_LIMIT,
    windowMs: RATE_LIMIT_WINDOW_MS
  });
  if (!tenantOk) {
    return deny("Tenant tool execution rate limit exceeded.");
  }

  // Execute tool through isolated Code Mode subprocess OR MCP Client -> MCP Server
  try {
    if (toolName === "execute_connector_code") {
      const argsObj = parsed.data as {
        code: string;
        input?: Record<string, unknown>;
        maxCalls?: number;
        timeoutMs?: number;
      };
      const codeRes = await executeLuticConnectorCode({
        code: argsObj.code,
        input: argsObj.input,
        maxCalls: argsObj.maxCalls,
        timeoutMs: argsObj.timeoutMs,
        ctx,
        options
      });
      if (codeRes.status === "requires_confirmation" && codeRes.pendingAction) {
        return {
          status: "requires_confirmation",
          toolName,
          pendingAction: codeRes.pendingAction,
          data: codeRes as unknown as Record<string, unknown>,
          latencyMs: codeRes.latencyMs
        };
      }
      const data = codeRes as unknown as Record<string, unknown>;
      const resultHash = sha256Hex(JSON.stringify(data));
      await writeAuditEntry(ctx.db, {
        tenantId: ctx.user.tenantId,
        userId: ctx.user.userId,
        role: ctx.user.role,
        conversationId: ctx.conversationId,
        action: "tool_call",
        toolName,
        args: { codeLength: argsObj.code.length, innerCallCount: codeRes.innerCalls.length },
        resultHash,
        status: "allowed",
        reason: "Code Mode OK",
        latencyMs: codeRes.latencyMs
      });
      return {
        status: "allowed",
        toolName,
        data,
        untrustedWrappedText: wrapUntrustedToolResult(toolName, data),
        latencyMs: codeRes.latencyMs
      };
    }

    const result = await registry.callToolOverMcp(
      toolName,
      parsed.data as Record<string, unknown>,
      ctx
    );
    const latencyMs = Date.now() - started;
    const resultHash = sha256Hex(JSON.stringify(result));
    const status = def.access === "write" ? "confirmed" : "allowed";

    await writeAuditEntry(ctx.db, {
      tenantId: ctx.user.tenantId,
      userId: ctx.user.userId,
      role: ctx.user.role,
      conversationId: ctx.conversationId,
      action: def.access === "write" ? "write_confirmed" : "tool_call",
      toolName,
      args: parsed.data as Record<string, unknown>,
      resultHash,
      status,
      reason: def.access === "write" ? `Confirmed (${ctx.confirmationId})` : "OK",
      latencyMs
    });

    return {
      status,
      toolName,
      data: result,
      untrustedWrappedText: wrapUntrustedToolResult(toolName, result),
      latencyMs
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message = err instanceof Error ? err.message : "Tool execution failed";
    await writeAuditEntry(ctx.db, {
      tenantId: ctx.user.tenantId,
      userId: ctx.user.userId,
      role: ctx.user.role,
      conversationId: ctx.conversationId,
      action: "tool_call",
      toolName,
      args: parsed.data as Record<string, unknown>,
      resultHash: "",
      status: "error",
      reason: message,
      latencyMs
    });
    return {
      status: "error",
      toolName,
      denialReason: message,
      latencyMs
    };
  }
}

export const ConfirmationInputSchema = z.object({
  actionId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  decision: z.enum(["confirm", "cancel"])
});
