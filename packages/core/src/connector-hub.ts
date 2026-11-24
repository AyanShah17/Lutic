import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { decryptCredentials } from "./crypto";
import type { KojoDatabase } from "./db/client";
import {
  connectorConnections,
  connectorSyncLogs,
  connectorTriggers,
  workflowRuns,
  workflows
} from "./db/schema";
import {
  callRemoteMcpTool,
  callUtcpTool,
  discoverRemoteMcpTools,
  discoverUtcpTools,
  type ExternalConnectorTool
} from "./external-connectors";
import { getRuntimeHooks, isDemoMode } from "./runtime";

type TriggerWorkflowExecutor = (db: KojoDatabase, runId: string) => Promise<void>;
let registeredTriggerExecutor: TriggerWorkflowExecutor | undefined;

export function registerTriggerWorkflowExecutor(fn: TriggerWorkflowExecutor): void {
  registeredTriggerExecutor = fn;
}

export interface CatalogConnectorEntry {
  slug: string;
  name: string;
  category: "mcp" | "http" | "scada" | "erp" | "messaging" | "custom";
  transport: "in_memory_mcp" | "kojo_protocol" | "remote_mcp" | "utcp_http" | "http" | "webhook" | "simulated";
  description: string;
  defaultTools: Array<{ name: string; description: string }>;
  credentialFields: Array<{ key: string; label: string; secret?: boolean; defaultValue?: string }>;
}

export const CONNECTOR_CATALOG: CatalogConnectorEntry[] = [
  {
    slug: "cmms",
    name: "Kojo CMMS Hub",
    category: "mcp",
    transport: "in_memory_mcp",
    description: "Work orders, machine repair history, ISO failure modes, and draft creation.",
    defaultTools: [
      { name: "get_work_orders", description: "List maintenance work orders" },
      { name: "get_machine_history", description: "Repair and alarm history for machine" },
      { name: "find_similar_faults", description: "Search historical fault resolutions" },
      { name: "draft_work_order", description: "Create confirmed maintenance work order" }
    ],
    credentialFields: [
      { key: "endpoint", label: "CMMS Endpoint", defaultValue: "mock://cmms.local" },
      { key: "apiKey", label: "API Key", secret: true, defaultValue: "cmms-demo-key" }
    ]
  },
  {
    slug: "historian",
    name: "Kojo Historian & SCADA Hub",
    category: "scada",
    transport: "in_memory_mcp",
    description: "Live machine states, active alarms, and time-binned sensor telemetry.",
    defaultTools: [
      { name: "list_machines", description: "List authorized machines and statuses" },
      { name: "get_machine", description: "Get ISA-95 machine asset details" },
      { name: "get_machine_status", description: "Get live temperature/vibration/pressure" },
      { name: "get_active_alarms", description: "Fetch uncleared machine alarms" },
      { name: "get_recent_readings", description: "Aggregated date_bin sensor telemetry" }
    ],
    credentialFields: [
      { key: "endpoint", label: "Historian Endpoint", defaultValue: "mock://historian.local" },
      { key: "token", label: "Access Token", secret: true, defaultValue: "historian-demo-token" }
    ]
  },
  {
    slug: "mes",
    name: "Kojo MES Production Hub",
    category: "mcp",
    transport: "in_memory_mcp",
    description: "Semantic OEE, downtime, quality, throughput, and declarative dashboards.",
    defaultTools: [
      { name: "list_metrics", description: "List 12 semantic metrics" },
      { name: "query_metric", description: "Query plant/line/machine metrics" },
      { name: "compare_metrics", description: "Compare two metrics across dimensions" },
      { name: "create_dashboard_draft", description: "Build declarative dashboard spec" }
    ],
    credentialFields: [
      { key: "endpoint", label: "MES Endpoint", defaultValue: "mock://mes.local" },
      { key: "apiKey", label: "API Key", secret: true, defaultValue: "mes-demo-key" }
    ]
  },
  {
    slug: "parts-erp",
    name: "Kojo Parts & Inventory Hub",
    category: "erp",
    transport: "in_memory_mcp",
    description: "Spare parts inventory levels, BOM links, lead times, and reservations.",
    defaultTools: [
      { name: "get_parts_inventory", description: "Check stock and min levels" },
      { name: "find_part_for_fault", description: "Lookup compatible parts by fault code" },
      { name: "reserve_part", description: "Reserve spare part with confirmation" }
    ],
    credentialFields: [
      { key: "endpoint", label: "ERP Endpoint", defaultValue: "mock://parts-erp.local" },
      { key: "clientSecret", label: "Client Secret", secret: true, defaultValue: "erp-demo-secret" }
    ]
  },
  {
    slug: "docs",
    name: "Kojo Knowledge & SOP Hub",
    category: "mcp",
    transport: "in_memory_mcp",
    description: "Hybrid vector + FTS search over OEM manuals, SOPs, and safety policies.",
    defaultTools: [
      { name: "search_documents", description: "Search current plant manuals & SOPs" },
      { name: "get_document_section", description: "Retrieve exact document passage" }
    ],
    credentialFields: [
      { key: "rootPath", label: "Manuals Store Path", defaultValue: "/knowledge/manuals" }
    ]
  },
  {
    slug: "http",
    name: "Kojo Outbound Webhook Bridge",
    category: "http",
    transport: "simulated",
    description: "Connect external SCADA webhooks, REST endpoints, or custom industrial APIs.",
    defaultTools: [
      { name: "http_probe", description: "Probe configured endpoint health" },
      { name: "dispatch_webhook", description: "Send JSON payload to endpoint" }
    ],
    credentialFields: [
      { key: "endpointUrl", label: "Endpoint URL", defaultValue: "mock://custom-scada.local" },
      { key: "apiKey", label: "API Key / Secret", secret: true }
    ]
  },
  {
    slug: "metorial",
    name: "Metorial MCP Hub (600+ Integrations)",
    category: "mcp",
    transport: "remote_mcp",
    description: "Connect any Metorial Magic MCP endpoint or remote Streamable HTTP MCP server.",
    defaultTools: [],
    credentialFields: [
      { key: "endpointUrl", label: "Metorial Magic MCP URL", defaultValue: "https://mcp.metorial.example/mcp" },
      { key: "apiKey", label: "Bearer Token / API Key", secret: true }
    ]
  },
  {
    slug: "open-connector",
    name: "OpenConnectors Gateway (400+ SaaS/APIs)",
    category: "mcp",
    transport: "remote_mcp",
    description: "Connect self-hosted Open-Connector or UTCP-MCP bridge endpoints over Streamable HTTP MCP.",
    defaultTools: [],
    credentialFields: [
      { key: "endpointUrl", label: "OpenConnectors MCP URL", defaultValue: "https://open-connector.example/mcp" },
      { key: "apiKey", label: "Bearer Token / API Key", secret: true }
    ]
  },
  {
    slug: "utcp-http",
    name: "UTCP Direct HTTP / OpenAPI Manual",
    category: "http",
    transport: "utcp_http",
    description: "Import any UTCP 1.0 JSON manual or OpenAPI 3.x spec for direct HTTP tool invocation.",
    defaultTools: [],
    credentialFields: [
      { key: "endpointUrl", label: "UTCP Manual or OpenAPI JSON URL", defaultValue: "https://api.example.com/utcp.json" },
      { key: "apiKey", label: "Bearer Token / API Key", secret: true }
    ]
  }
];

type ConnectorConnection = typeof connectorConnections.$inferSelect;
type DiscoverLocalTools = (kind: string) => Promise<Array<{ name: string; description?: string }>>;

export interface KojoConnectorManual {
  protocol: "kojo-connector-v1";
  codeModeGlobal: "kojo";
  connectorSlug: string;
  transport: string;
  endpointUrl: string;
  tools: Array<{ name: string; description?: string }>;
}

/**
 * Combines direct connector descriptors and MCP tool definitions under the unified Kojo protocol manual.
 */
export function buildKojoConnectorManual(
  connector: Pick<ConnectorConnection, "slug" | "transport" | "endpointUrl" | "discoveredTools">,
  tools?: Array<{ name: string; description?: string }>
): KojoConnectorManual {
  const discovered = (connector.discoveredTools ?? []).map((t) => ({
    name: String(t.name ?? ""),
    description: typeof t.description === "string" ? t.description : undefined
  }));
  return {
    protocol: "kojo-connector-v1",
    codeModeGlobal: "kojo",
    connectorSlug: connector.slug,
    transport: connector.transport,
    endpointUrl: connector.endpointUrl,
    tools: tools ?? discovered
  };
}

export function getLocalConnectorKind(conn: Pick<ConnectorConnection, "transport" | "endpointUrl">): string | undefined {
  if (conn.transport !== "in_memory_mcp" && conn.transport !== "kojo_protocol") return undefined;
  return /^(?:kojo|mcp):\/\/([a-z-]+)$/.exec(conn.endpointUrl)?.[1];
}

async function discoverConfiguredLocalTools(conn: ConnectorConnection, discover?: DiscoverLocalTools) {
  const kind = getLocalConnectorKind(conn);
  return kind && discover ? discover(kind) : [];
}

const UNSUPPORTED_CONNECTOR_MESSAGE = "This connector has no implemented adapter for health checks or tool discovery";

function isExternalBridgeTransport(transport: string): transport is "remote_mcp" | "utcp_http" {
  return transport === "remote_mcp" || transport === "utcp_http";
}

function readConnectorCredentials(
  conn: Pick<ConnectorConnection, "encryptedCredentials">
): Record<string, unknown> | undefined {
  if (!conn.encryptedCredentials) return undefined;
  return decryptCredentials(conn.encryptedCredentials);
}

export async function testConnectorConnection(
  db: KojoDatabase,
  tenantId: string,
  connectionId: string,
  discoverLocalTools?: DiscoverLocalTools
) {
  const started = Date.now();
  const rows = await db
    .select()
    .from(connectorConnections)
    .where(
      and(
        eq(connectorConnections.id, connectionId),
        eq(connectorConnections.tenantId, tenantId)
      )
    )
    .limit(1);

  const conn = rows[0];
  if (!conn) {
    throw new Error(`Connector '${connectionId}' not found`);
  }

  let credsValid = true;
  let creds: Record<string, unknown> | undefined;
  if (conn.encryptedCredentials) {
    try {
      creds = decryptCredentials(conn.encryptedCredentials);
    } catch {
      credsValid = false;
    }
  }

  const demo = isDemoMode();
  const isExternalBridge = isExternalBridgeTransport(conn.transport);
  let supported = demo;
  let discoveredCount = 0;
  let bridgeError: string | null = null;

  if (isExternalBridge) {
    supported = true;
    if (credsValid) {
      try {
        const externalTools =
          conn.transport === "remote_mcp"
            ? await discoverRemoteMcpTools(conn.endpointUrl, creds)
            : await discoverUtcpTools(conn.endpointUrl, creds);
        discoveredCount = externalTools.length;
      } catch (err) {
        bridgeError = err instanceof Error ? err.message : String(err);
      }
    }
  } else if (!demo) {
    const localTools = await discoverConfiguredLocalTools(conn, discoverLocalTools);
    supported = localTools.length > 0;
    discoveredCount = localTools.length;
  }

  const now = new Date();
  const latencyMs = Math.max(1, Date.now() - started);
  const healthy = supported && credsValid && !bridgeError;
  const message = !supported
    ? UNSUPPORTED_CONNECTOR_MESSAGE
    : !credsValid
      ? "Encrypted credentials could not be decrypted"
      : bridgeError
        ? bridgeError
        : isExternalBridge
          ? `${conn.transport === "remote_mcp" ? "Remote MCP" : "UTCP/OpenAPI"} endpoint responded (${discoveredCount} tool(s))`
          : demo
            ? `Demo health check passed for ${conn.name}`
            : `Local MCP adapter for ${conn.name} responded to tool discovery`;

  await db
    .update(connectorConnections)
    .set({
      status: healthy ? "connected" : "error",
      lastError: healthy ? null : message,
      updatedAt: now
    })
    .where(eq(connectorConnections.id, conn.id));

  await db.insert(connectorSyncLogs).values({
    id: `csl-${crypto.randomUUID().slice(0, 12)}`,
    tenantId,
    connectionId: conn.id,
    direction: "test",
    status: healthy ? "success" : "failed",
    recordsSynced: 0,
    latencyMs,
    message,
    payload: { transport: conn.transport, endpointUrl: conn.endpointUrl }
  });

  return {
    ok: healthy,
    supported,
    healthy,
    status: healthy ? "healthy" : "error",
    health: {
      status: healthy ? "healthy" : "error",
      latencyMs,
      message
    },
    latencyMs,
    message
  };
}

export async function syncConnectorConnection(
  db: KojoDatabase,
  tenantId: string,
  connectionId: string,
  discoverLocalTools?: DiscoverLocalTools
) {
  const started = Date.now();
  const rows = await db
    .select()
    .from(connectorConnections)
    .where(
      and(
        eq(connectorConnections.id, connectionId),
        eq(connectorConnections.tenantId, tenantId)
      )
    )
    .limit(1);

  const conn = rows[0];
  if (!conn) {
    throw new Error(`Connector '${connectionId}' not found`);
  }

  const catalogEntry =
    CONNECTOR_CATALOG.find((c) => c.slug === conn.slug) ??
    CONNECTOR_CATALOG.find((c) => c.category === conn.category);

  const demo = isDemoMode();
  const isExternalBridge = isExternalBridgeTransport(conn.transport);
  let supported = demo;
  let discoveredTools: Array<Record<string, unknown> & { name: string; description?: string }> = [];
  let syncError: string | null = null;

  if (isExternalBridge) {
    supported = true;
    try {
      const creds = readConnectorCredentials(conn);
      const externalTools =
        conn.transport === "remote_mcp"
          ? await discoverRemoteMcpTools(conn.endpointUrl, creds)
          : await discoverUtcpTools(conn.endpointUrl, creds);
      discoveredTools = externalTools.map((t) => ({ ...t }));
      if (discoveredTools.length === 0) {
        syncError = `Endpoint '${conn.endpointUrl}' returned 0 tools.`;
      }
    } catch (err) {
      syncError = err instanceof Error ? err.message : String(err);
    }
  } else if (demo) {
    discoveredTools =
      conn.discoveredTools && conn.discoveredTools.length > 0
        ? (conn.discoveredTools as Array<{ name: string; description?: string }>)
        : (catalogEntry?.defaultTools ?? [{ name: "ping", description: "Probe connector" }]);
  } else {
    const localTools = await discoverConfiguredLocalTools(conn, discoverLocalTools);
    supported = localTools.length > 0;
    discoveredTools = localTools;
  }

  const ok = !syncError && discoveredTools.length > 0;
  const failureMessage = syncError ?? (supported ? "No tools discovered" : UNSUPPORTED_CONNECTOR_MESSAGE);

  const now = new Date();
  const latencyMs = Math.max(2, Date.now() - started);

  await db
    .update(connectorConnections)
    .set({
      status: ok ? "connected" : "error",
      ...(ok ? { discoveredTools, lastSyncAt: now } : {}),
      lastError: ok ? null : failureMessage,
      updatedAt: now
    })
    .where(eq(connectorConnections.id, conn.id));

  const logId = `csl-${crypto.randomUUID().slice(0, 12)}`;
  const logRow = {
    id: logId,
    tenantId,
    connectionId: conn.id,
    direction: "inbound" as const,
    status: ok ? ("success" as const) : ("failed" as const),
    recordsSynced: discoveredTools.length,
    latencyMs,
    message: ok
      ? `Discovered ${discoveredTools.length} ${
          isExternalBridge ? (conn.transport === "remote_mcp" ? "remote MCP" : "UTCP") : demo ? "demo" : "local MCP"
        } tool(s) for ${conn.name}`
      : failureMessage,
    payload: { tools: discoveredTools.map((t) => t.name) }
  };

  await db.insert(connectorSyncLogs).values(logRow);

  return {
    ok,
    supported,
    status: logRow.status,
    message: logRow.message,
    syncedAt: ok ? now.toISOString() : null,
    lastSyncAt: ok ? now.toISOString() : conn.lastSyncAt?.toISOString() ?? null,
    tools: discoveredTools,
    sync: logRow
  };
}

/**
 * Invokes a tool on a registered remote_mcp or utcp_http connector with encrypted credentials.
 */
export async function invokeExternalConnectorTool(
  db: KojoDatabase,
  conn: ConnectorConnection,
  toolName: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const creds = readConnectorCredentials(conn);
  if (conn.transport === "remote_mcp") {
    return callRemoteMcpTool(conn.endpointUrl, toolName, args, creds);
  }
  if (conn.transport === "utcp_http") {
    let tools = (conn.discoveredTools ?? []) as unknown as ExternalConnectorTool[];
    let toolDef = tools.find((t) => t.name === toolName);
    if (!toolDef) {
      tools = await discoverUtcpTools(conn.endpointUrl, creds);
      await db
        .update(connectorConnections)
        .set({ discoveredTools: tools.map((t) => ({ ...t })), lastSyncAt: new Date(), updatedAt: new Date() })
        .where(eq(connectorConnections.id, conn.id));
      toolDef = tools.find((t) => t.name === toolName);
    }
    if (!toolDef) {
      throw new Error(`UTCP tool '${toolName}' not found on connector '${conn.slug}'.`);
    }
    return callUtcpTool(conn.endpointUrl, toolDef, args, creds);
  }
  throw new Error(`Unsupported external bridge transport '${conn.transport}'.`);
}

export async function fireConnectorTrigger(
  db: KojoDatabase,
  tenantId: string,
  triggerId: string,
  payload?: Record<string, unknown>
) {
  const rows = await db
    .select()
    .from(connectorTriggers)
    .where(
      and(
        eq(connectorTriggers.id, triggerId),
        eq(connectorTriggers.tenantId, tenantId)
      )
    )
    .limit(1);

  const trig = rows[0];
  if (!trig) {
    throw new Error(`Trigger '${triggerId}' not found`);
  }

  const now = new Date();
  await db
    .update(connectorTriggers)
    .set({ lastFiredAt: now })
    .where(eq(connectorTriggers.id, trig.id));

  let runId: string | null = null;
  if (trig.workflowId) {
    const wfRows = await db
      .select({ id: workflows.id, currentVersion: workflows.currentVersion })
      .from(workflows)
      .where(
        and(eq(workflows.id, trig.workflowId), eq(workflows.tenantId, tenantId))
      )
      .limit(1);
    if (wfRows[0]) {
      runId = `wfr-${crypto.randomUUID().slice(0, 12)}`;
      await db.insert(workflowRuns).values({
        id: runId,
        tenantId,
        workflowId: wfRows[0].id,
        version: wfRows[0].currentVersion,
        status: "queued",
        triggerSource: "connector",
        triggeredBy: trig.id,
        input: {
          triggerId: trig.id,
          eventType: trig.eventType,
          ...(payload ?? {})
        },
        stepTraces: [],
        startedAt: now
      });
      const exec = registeredTriggerExecutor ?? getRuntimeHooks()?.executeWorkflowRun;
      if (exec) {
        await exec(db, runId);
      }
    }
  }

  return {
    ok: true,
    triggerId: trig.id,
    firedAt: now.toISOString(),
    workflowRunId: runId
  };
}

export async function listConnectorSyncLogs(
  db: KojoDatabase,
  tenantId: string,
  connectionId?: string,
  limit = 30
) {
  const conds = [eq(connectorSyncLogs.tenantId, tenantId)];
  if (connectionId) conds.push(eq(connectorSyncLogs.connectionId, connectionId));
  return db
    .select()
    .from(connectorSyncLogs)
    .where(and(...conds))
    .orderBy(desc(connectorSyncLogs.createdAt))
    .limit(limit);
}
