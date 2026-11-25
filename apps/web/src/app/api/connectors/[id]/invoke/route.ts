import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  assets,
  auditLog,
  authorize,
  connectorConnections,
  connectorSyncLogs,
  eq,
  getLocalConnectorKind,
  hasLiveAdapterSupport,
  invokeExternalConnectorTool,
  isCodeModeEnabled,
  isDemoMode,
  sha256Hex
} from "@lutic/core";
import { defaultMcpRegistry } from "@lutic/connectors";
import { executeLuticConnectorCode } from "@lutic/agent";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const InvokeSchema = z.object({
  mode: z.enum(["tool", "code"]).optional(),
  code: z.string().min(1).max(4000).optional(),
  toolName: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  confirmWrite: z.boolean().optional()
});

function buildConnectorSimulationResult(
  conn: { id: string; slug: string },
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  if (toolName.startsWith("sap_")) {
    return {
      simulated: true,
      system: "SAP S/4HANA",
      module: conn.slug.toUpperCase(),
      toolName,
      records: [
        { documentNumber: "4000812", plant: "DET-01", equipment: "L3-FILLER-E42", status: "REL", stockAvailable: 6 },
        { documentNumber: "4000819", plant: "AUS-02", equipment: "CNC-01", status: "CRTD", stockAvailable: 12 }
      ],
      args,
      respondedAt: nowIso
    };
  }
  if (toolName.startsWith("aws_")) {
    return {
      simulated: true,
      system: "AWS Operations",
      service: conn.slug,
      region: "us-east-1",
      toolName,
      metrics: { assetPropertyValue: 64.2, unit: "degC", quality: "GOOD", alarmsActive: 1 },
      args,
      respondedAt: nowIso
    };
  }
  if (toolName.startsWith("snow_")) {
    return {
      simulated: true,
      system: "ServiceNow ITSM",
      toolName,
      ticket: { number: "INC004192", state: "In Progress", priority: "2 - High", ci: "L3-FILLER-E42" },
      args,
      respondedAt: nowIso
    };
  }
  if (toolName.startsWith("mqtt_") || toolName.startsWith("opcua_") || toolName.startsWith("modbus_")) {
    return {
      simulated: true,
      protocol: conn.slug.toUpperCase(),
      toolName,
      telemetry: { node: "ns=2;s=Line3.FillerE42.VibrationRMS", value: 4.18, unit: "mm/s", quality: "Good" },
      args,
      respondedAt: nowIso
    };
  }
  return {
    simulated: true,
    connectorId: conn.id,
    slug: conn.slug,
    toolName,
    args,
    respondedAt: nowIso
  };
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
    authorize(user, "connector:write", { tenantId: user.tenantId });

    const body = InvokeSchema.parse(await req.json());
    if ((body.mode === "code" || typeof body.code === "string") && !isCodeModeEnabled()) {
      return problemResponse(501, "Code Mode Unavailable", "Lutic Code Mode is available only in trusted development and test runtimes.");
    }
    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(connectorConnections)
        .where(
          and(
            eq(connectorConnections.id, params.id),
            eq(connectorConnections.tenantId, user.tenantId)
          )
        )
        .limit(1);

      const conn = rows[0];
      if (!conn) {
        return problemResponse(404, "Not Found", "Connector not found.");
      }

      const args = body.args ?? body.input ?? {};
      const started = Date.now();

      if (body.mode === "code" || typeof body.code === "string") {
        if (!body.code || !body.code.trim()) {
          return problemResponse(400, "Validation Error", "code script is required when mode is 'code'.");
        }
        try {
          const codeRes = await executeLuticConnectorCode({
            code: body.code,
            input: args,
            ctx: {
              db,
              user,
              requestId: `play-cm-${crypto.randomUUID().slice(0, 8)}`
            },
            options: { registry: defaultMcpRegistry }
          });
          const latencyMs = Math.max(1, Date.now() - started);
          await db.insert(auditLog).values({
            id: `aud-${crypto.randomUUID().slice(0, 12)}`,
            tenantId: user.tenantId,
            userId: user.userId,
            role: user.role,
            conversationId: null,
            action: "connector_code_invoke",
            toolName: "execute_connector_code",
            args: { connectorId: conn.id, mode: "code", innerCallCount: codeRes.innerCalls.length },
            resultHash: sha256Hex(JSON.stringify(codeRes.result ?? {})),
            status: codeRes.status === "error" ? "error" : "allowed",
            reason: `Connector ${conn.slug} Code Mode`,
            latencyMs
          });
          await db.insert(connectorSyncLogs).values({
            id: `csl-${crypto.randomUUID().slice(0, 12)}`,
            tenantId: user.tenantId,
            connectionId: conn.id,
            direction: "code-mode",
            status: codeRes.status === "error" ? "failed" : "success",
            recordsSynced: codeRes.innerCalls.length,
            latencyMs,
            message: `Code Mode executed ${codeRes.innerCalls.length} tool call(s)`,
            payload: { innerCalls: codeRes.innerCalls.map((c) => c.toolName) }
          });

          if (codeRes.status === "requires_confirmation" && codeRes.pendingAction) {
            return NextResponse.json({
              ok: true,
              protocol: codeRes.protocol,
              mode: "code",
              status: "requires_confirmation",
              pendingAction: codeRes.pendingAction,
              innerCalls: codeRes.innerCalls,
              latencyMs
            });
          }

          return NextResponse.json({
            ok: true,
            protocol: codeRes.protocol,
            mode: "code",
            status: codeRes.status,
            result: codeRes.result,
            logs: codeRes.logs,
            innerCalls: codeRes.innerCalls,
            latencyMs
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Code Mode execution failed";
          const status = /timed out/i.test(msg) ? 408 : /denied|scope|permission/i.test(msg) ? 403 : 400;
          return problemResponse(status, "Code Mode Execution Error", msg);
        }
      }

      const toolName = body.toolName ?? body.tool;
      if (!toolName) {
        return problemResponse(400, "Validation Error", "toolName is required.");
      }

      const isRemoteBridge =
        conn.transport === "remote_mcp" ||
        conn.transport === "utcp_http" ||
        hasLiveAdapterSupport(conn);
      const mcpDef = isRemoteBridge ? undefined : defaultMcpRegistry.getToolDefinition(toolName);
      let result: Record<string, unknown>;
      if (isRemoteBridge) {
        result = await invokeExternalConnectorTool(db, conn, toolName, args);
      } else if (!isDemoMode() && (!mcpDef || mcpDef.connectorKind !== getLocalConnectorKind(conn))) {
        return problemResponse(501, "Connector invocation unavailable", "This tool is unavailable for the configured connector.");
      } else if (mcpDef) {
        authorize(user, mcpDef.requiredPermission, { tenantId: user.tenantId });

        const filtersObj =
          args.filters && typeof args.filters === "object" && !Array.isArray(args.filters)
            ? (args.filters as Record<string, unknown>)
            : undefined;
        const requestedPlantId =
          typeof args.plantId === "string" && args.plantId.trim() !== ""
            ? args.plantId.trim()
            : typeof filtersObj?.plantId === "string" && filtersObj.plantId.trim() !== ""
              ? filtersObj.plantId.trim()
              : undefined;
        if (requestedPlantId) {
          authorize(user, mcpDef.requiredPermission, {
            tenantId: user.tenantId,
            plantId: requestedPlantId
          });
        }

        const requestedMachineId =
          typeof args.machineId === "string" && args.machineId.trim() !== ""
            ? args.machineId.trim()
            : typeof filtersObj?.machineId === "string" && filtersObj.machineId.trim() !== ""
              ? filtersObj.machineId.trim()
              : undefined;
        if (requestedMachineId) {
          const machineRows = await db
            .select({ id: assets.id, plantId: assets.plantId, tenantId: assets.tenantId })
            .from(assets)
            .where(and(eq(assets.id, requestedMachineId), eq(assets.tenantId, user.tenantId)))
            .limit(1);
          const machine = machineRows[0];
          if (!machine) {
            return problemResponse(404, "Not Found", `Machine '${requestedMachineId}' not found.`);
          }
          authorize(user, mcpDef.requiredPermission, {
            tenantId: machine.tenantId,
            plantId: machine.plantId
          });
        }

        const parsedArgs = mcpDef.inputSchema.safeParse(args);
        if (!parsedArgs.success) {
          const issueMsg = parsedArgs.error.issues
            .map((i) => `${i.path.join(".") || "args"}: ${i.message}`)
            .join("; ");
          return problemResponse(400, "Validation Error", `Invalid arguments for '${toolName}': ${issueMsg}`);
        }

        if (mcpDef.access === "write" && body.confirmWrite !== true) {
          await db.insert(auditLog).values({
            id: `aud-${crypto.randomUUID().slice(0, 12)}`,
            tenantId: user.tenantId,
            userId: user.userId,
            role: user.role,
            conversationId: null,
            action: "connector_invoke",
            toolName,
            args,
            resultHash: "",
            status: "denied",
            reason: "Write tool requires confirmWrite: true",
            latencyMs: Math.max(1, Date.now() - started)
          });
          return problemResponse(
            409,
            "Confirmation Required",
            `Write tool '${toolName}' requires explicit confirmWrite: true.`
          );
        }

        result = await defaultMcpRegistry.callToolOverMcp(
          toolName,
          parsedArgs.data as Record<string, unknown>,
          {
            db,
            user,
            requestId: `play-${crypto.randomUUID().slice(0, 8)}`
          }
        );
      } else {
        result = buildConnectorSimulationResult(conn, toolName, args);
      }

      const latencyMs = Math.max(1, Date.now() - started);
      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        conversationId: null,
        action: "connector_invoke",
        toolName,
        args,
        resultHash: sha256Hex(JSON.stringify(result)),
        status: "allowed",
        reason: `Connector ${conn.slug}`,
        latencyMs
      });
      await db.insert(connectorSyncLogs).values({
        id: `csl-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        connectionId: conn.id,
        direction: "invoke",
        status: "success",
        recordsSynced: 1,
        latencyMs,
        message: `Invoked tool ${toolName}`,
        payload: { toolName, args }
      });

      return NextResponse.json({
        ok: true,
        toolName,
        latencyMs,
        result,
        output: result,
        data: result
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
