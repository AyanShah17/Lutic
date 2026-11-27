import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import generatedConnectorCatalog from "./connector-catalog.generated.json";
import { refreshOAuthCredentialsIfExpired } from "./connector-auth";
import { decryptCredentials, encryptCredentials } from "./crypto";
import type { LuticDatabase } from "./db/client";
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
import {
  hasLiveAdapterSupport,
  invokeLiveAdapterTool,
  testLiveAdapter
} from "./live-adapters";
import { getRuntimeHooks, isDemoMode } from "./runtime";

type TriggerWorkflowExecutor = (db: LuticDatabase, runId: string) => Promise<void>;
let registeredTriggerExecutor: TriggerWorkflowExecutor | undefined;

export function registerTriggerWorkflowExecutor(fn: TriggerWorkflowExecutor): void {
  registeredTriggerExecutor = fn;
}

export interface CatalogConnectorEntry {
  slug: string;
  name: string;
  category: "mcp" | "http" | "scada" | "erp" | "messaging" | "custom";
  transport: "in_memory_mcp" | "lutic_protocol" | "remote_mcp" | "utcp_http" | "http" | "webhook" | "simulated";
  description: string;
  defaultTools: Array<{ name: string; description: string }>;
  credentialFields: Array<{ key: string; label: string; secret?: boolean; defaultValue?: string }>;
}

export const CONNECTOR_CATALOG: CatalogConnectorEntry[] = [
  {
    slug: "sap-pm",
    name: "SAP S/4HANA PM (Plant Maintenance)",
    category: "erp",
    transport: "simulated",
    description: "Sync SAP Plant Maintenance notifications, maintenance orders, equipment BOMs, and operation confirmations.",
    defaultTools: [
      { name: "sap_pm_list_notifications", description: "List open SAP PM M2 notifications by plant" },
      { name: "sap_pm_create_order", description: "Create SAP PM corrective order with material reservations" },
      { name: "sap_pm_confirm_operation", description: "Post completion hours and cause code to SAP PM" },
      { name: "sap_pm_get_equipment_bom", description: "Read functional location and spare BOM from SAP PM" }
    ],
    credentialFields: [
      { key: "endpointUrl", label: "SAP OData / RFC Endpoint", defaultValue: "sap://s4hana-prd.internal/sap/opu/odata/sap/API_MAINTORDER" },
      { key: "apiKey", label: "SAP Service Client Secret", secret: true }
    ]
  },
  {
    slug: "sap-mm",
    name: "SAP S/4HANA MM (Materials & Spares)",
    category: "erp",
    transport: "simulated",
    description: "Check plant warehouse stock, blocked stock, lead times, and raise spare-part reservations or requisitions in SAP MM.",
    defaultTools: [
      { name: "sap_mm_check_stock", description: "Query unrestricted plant warehouse inventory in SAP MM" },
      { name: "sap_mm_create_purchase_req", description: "Create SAP MM purchase requisition for depleted spares" },
      { name: "sap_mm_reserve_material", description: "Reserve spare material against a maintenance order" }
    ],
    credentialFields: [
      { key: "endpointUrl", label: "SAP MM OData Endpoint", defaultValue: "sap://s4hana-prd.internal/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV" },
      { key: "apiKey", label: "SAP Service Client Secret", secret: true }
    ]
  },
  {
    slug: "sap-pp",
    name: "SAP S/4HANA PP (Production Planning)",
    category: "erp",
    transport: "simulated",
    description: "Read active process/production orders, work-center routings, and yield confirmations from SAP PP.",
    defaultTools: [
      { name: "sap_pp_list_orders", description: "List scheduled production orders and line capacity" },
      { name: "sap_pp_get_routing", description: "Fetch work-center operations and cycle standards" },
      { name: "sap_pp_confirm_yield", description: "Post good yield and scrap quantities to SAP PP" }
    ],
    credentialFields: [
      { key: "endpointUrl", label: "SAP PP OData Endpoint", defaultValue: "sap://s4hana-prd.internal/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV" },
      { key: "apiKey", label: "SAP Service Client Secret", secret: true }
    ]
  },
  {
    slug: "sap-qm",
    name: "SAP S/4HANA QM (Quality Management)",
    category: "erp",
    transport: "simulated",
    description: "Monitor inspection lots, SPC tolerances, quality defects, and automated release decisions in SAP QM.",
    defaultTools: [
      { name: "sap_qm_list_inspection_lots", description: "List open quality inspection lots" },
      { name: "sap_qm_record_usage_decision", description: "Record inspection usage decision and lot status" },
      { name: "sap_qm_create_defect_notice", description: "Open SAP QN quality notification from anomaly" }
    ],
    credentialFields: [
      { key: "endpointUrl", label: "SAP QM OData Endpoint", defaultValue: "sap://s4hana-prd.internal/sap/opu/odata/sap/API_INSPECTIONLOT_SRV" },
      { key: "apiKey", label: "SAP Service Client Secret", secret: true }
    ]
  },
  {
    slug: "aws-iot",
    name: "AWS IoT SiteWise & IoT Core",
    category: "scada",
    transport: "simulated",
    description: "Ingest asset hierarchy properties, computed aggregates, and publish governed control topics via AWS IoT.",
    defaultTools: [
      { name: "aws_iot_get_asset_property", description: "Fetch latest live asset measurement from AWS IoT SiteWise" },
      { name: "aws_iot_query_aggregates", description: "Query time-windowed OEE/sensor aggregates" },
      { name: "aws_iot_publish_topic", description: "Publish governed JSON message to AWS IoT Core topic" }
    ],
    credentialFields: [
      { key: "endpointUrl", label: "AWS IoT Endpoint", defaultValue: "https://data.iotsitewise.us-east-1.amazonaws.com" },
      { key: "apiKey", label: "AWS IAM Role / Access Token", secret: true }
    ]
  },
  {
    slug: "aws-s3",
    name: "AWS S3 Operational Data Lake",
    category: "http",
    transport: "simulated",
    description: "Archive shift logs, telemetry snapshots, inspection photos, and compliance bundles to Amazon S3.",
    defaultTools: [
      { name: "aws_s3_list_objects", description: "List buckets and archived shift telemetry prefixes" },
      { name: "aws_s3_put_report_snapshot", description: "Archive executive report or trace bundle to S3" },
      { name: "aws_s3_get_archive_manifest", description: "Read manifest metadata for compliance audit objects" }
    ],
    credentialFields: [
      { key: "endpointUrl", label: "AWS S3 Bucket URI", defaultValue: "https://plant-datalake.s3.us-east-1.amazonaws.com" },
      { key: "apiKey", label: "AWS IAM Credentials / STS Token", secret: true }
    ]
  },
  {
    slug: "aws-cloudwatch",
    name: "AWS CloudWatch & Timestream",
    category: "http",
    transport: "simulated",
    description: "Correlate gateway health alarms, infrastructure metrics, and high-frequency Timestream series.",
    defaultTools: [
      { name: "aws_cw_list_alarms", description: "Fetch CloudWatch alarm state across edge gateways" },
      { name: "aws_cw_query_metrics", description: "Query CloudWatch edge gateway latency/error metrics" },
      { name: "aws_timestream_query", description: "Run read-only analytics query against Timestream" }
    ],
    credentialFields: [
      { key: "endpointUrl", label: "AWS Monitoring Endpoint", defaultValue: "https://monitoring.us-east-1.amazonaws.com" },
      { key: "apiKey", label: "AWS IAM Role / Token", secret: true }
    ]
  },
  {
    slug: "servicenow",
    name: "ServiceNow ITSM & OT Incident Bridge",
    category: "messaging",
    transport: "simulated",
    description: "Open and sync OT/IT incidents, maintenance change requests, and CMDB configuration items in ServiceNow.",
    defaultTools: [
      { name: "snow_list_incidents", description: "Query active ServiceNow OT/IT incidents" },
      { name: "snow_create_incident", description: "Create high-priority ServiceNow incident from alert" },
      { name: "snow_update_change_request", description: "Attach approval trace to a ServiceNow CHG ticket" },
      { name: "snow_lookup_cmdb_ci", description: "Resolve machine / gateway CI record from CMDB" }
    ],
    credentialFields: [
      { key: "endpointUrl", label: "ServiceNow Instance Table API URL", defaultValue: "https://instance.service-now.com/api/now" },
      { key: "apiKey", label: "OAuth Bearer Token / Client Secret", secret: true }
    ]
  },
  {
    slug: "mqtt-broker",
    name: "MQTT Broker (Sparkplug B / Telemetry)",
    category: "scada",
    transport: "simulated",
    description: "Subscribe to Sparkplug B topics, read edge telemetry payloads, and publish governed broker messages.",
    defaultTools: [
      { name: "mqtt_list_active_topics", description: "List live plant Sparkplug B telemetry topics" },
      { name: "mqtt_read_topic_snapshot", description: "Read latest retained message from an MQTT topic" },
      { name: "mqtt_publish_payload", description: "Publish governed status payload to MQTT broker" }
    ],
    credentialFields: [
      { key: "endpointUrl", label: "MQTT Broker URL (mqtt:// or mqtts://)", defaultValue: "mqtts://broker.plant.internal:8883" },
      { key: "apiKey", label: "Broker Username / Token", secret: true }
    ]
  },
  {
    slug: "opc-ua",
    name: "OPC-UA Industrial Server (PLC / CNC)",
    category: "scada",
    transport: "simulated",
    description: "Browse OPC-UA address spaces, inspect PLC/CNC tag nodes, and execute human-approved setpoint writes.",
    defaultTools: [
      { name: "opcua_browse_namespace", description: "Browse OPC-UA node hierarchy on line controllers" },
      { name: "opcua_read_nodes", description: "Read real-time PLC tag values and status codes" },
      { name: "opcua_write_setpoint", description: "Write approved parameter setpoint to OPC-UA node" }
    ],
    credentialFields: [
      { key: "endpointUrl", label: "OPC-UA Server Endpoint (opc.tcp://)", defaultValue: "opc.tcp://plc-line3.plant.internal:4840" },
      { key: "apiKey", label: "Client Certificate Thumbprint / Secret", secret: true }
    ]
  },
  {
    slug: "modbus-tcp",
    name: "Modbus TCP / RTU Fieldbus Gateway",
    category: "scada",
    transport: "simulated",
    description: "Poll Modbus holding/input registers from drives, chillers, and power meters with safe coil writes.",
    defaultTools: [
      { name: "modbus_read_holding_registers", description: "Read 16-bit holding registers from fieldbus unit" },
      { name: "modbus_read_input_registers", description: "Sample sensor analog input registers (temp, pressure)" },
      { name: "modbus_write_coil", description: "Toggle governed Modbus output coil after approval" }
    ],
    credentialFields: [
      { key: "endpointUrl", label: "Modbus TCP Gateway Address", defaultValue: "modbus://gateway-l3.plant.internal:502" },
      { key: "apiKey", label: "Gateway Auth Token (optional)", secret: true }
    ]
  },
  ...(generatedConnectorCatalog as CatalogConnectorEntry[])
];

type ConnectorConnection = typeof connectorConnections.$inferSelect;
type DiscoverLocalTools = (kind: string) => Promise<Array<{ name: string; description?: string }>>;

export interface LuticConnectorManual {
  protocol: "lutic-connector-v1";
  codeModeGlobal: "lutic";
  connectorSlug: string;
  transport: string;
  endpointUrl: string;
  tools: Array<{ name: string; description?: string }>;
}

/**
 * Combines direct connector descriptors and MCP tool definitions under the unified Lutic protocol manual.
 */
export function buildLuticConnectorManual(
  connector: Pick<ConnectorConnection, "slug" | "transport" | "endpointUrl" | "discoveredTools">,
  tools?: Array<{ name: string; description?: string }>
): LuticConnectorManual {
  const discovered = (connector.discoveredTools ?? []).map((t) => ({
    name: String(t.name ?? ""),
    description: typeof t.description === "string" ? t.description : undefined
  }));
  return {
    protocol: "lutic-connector-v1",
    codeModeGlobal: "lutic",
    connectorSlug: connector.slug,
    transport: connector.transport,
    endpointUrl: connector.endpointUrl,
    tools: tools ?? discovered
  };
}

export function getLocalConnectorKind(conn: Pick<ConnectorConnection, "transport" | "endpointUrl">): string | undefined {
  if (conn.transport !== "in_memory_mcp" && conn.transport !== "lutic_protocol") return undefined;
  return /^(?:lutic|mcp):\/\/([a-z-]+)$/.exec(conn.endpointUrl)?.[1];
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
  db: LuticDatabase,
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
  const isLiveAdapter = hasLiveAdapterSupport(conn);
  let supported = demo || isLiveAdapter;
  let discoveredCount = 0;
  let bridgeError: string | null = null;
  let liveMessage: string | null = null;

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
  } else if (isLiveAdapter) {
    supported = true;
    if (credsValid) {
      try {
        const probe = await testLiveAdapter(conn, creds);
        if (!probe.healthy) bridgeError = probe.message;
        else liveMessage = probe.message;
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
          ? `${conn.transport === "remote_mcp" ? "Lutic Cloud" : "Lutic Direct API"} endpoint responded (${discoveredCount} tool(s))`
          : liveMessage
            ? liveMessage
            : demo
              ? `Demo health check passed for ${conn.name}`
              : `Lutic native adapter for ${conn.name} responded to tool discovery`;

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
  db: LuticDatabase,
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
  const isLiveAdapter = hasLiveAdapterSupport(conn);
  let supported = demo || isLiveAdapter;
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
  } else if (isLiveAdapter || demo) {
    const baseEntry =
      catalogEntry ??
      CONNECTOR_CATALOG.find((c) => conn.slug === c.slug || conn.slug.startsWith(`${c.slug}-`));
    discoveredTools =
      conn.discoveredTools && conn.discoveredTools.length > 0
        ? (conn.discoveredTools as Array<{ name: string; description?: string }>)
        : (baseEntry?.defaultTools ?? [{ name: "ping", description: "Probe connector" }]);
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
          isExternalBridge ? (conn.transport === "remote_mcp" ? "remote MCP" : "OpenAPI") : demo ? "demo" : "native"
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
  db: LuticDatabase,
  conn: ConnectorConnection,
  toolName: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  let creds = readConnectorCredentials(conn);
  if (creds?.authScheme === "oauth2") {
    const refreshed = await refreshOAuthCredentialsIfExpired(creds);
    if (refreshed.refreshed && refreshed.creds) {
      creds = refreshed.creds;
      await db
        .update(connectorConnections)
        .set({
          encryptedCredentials: encryptCredentials(creds),
          updatedAt: new Date()
        })
        .where(eq(connectorConnections.id, conn.id));
    }
  }
  if (hasLiveAdapterSupport(conn)) {
    return invokeLiveAdapterTool(conn, toolName, args, creds);
  }
  if (conn.transport === "remote_mcp") {
    return callRemoteMcpTool(conn.endpointUrl, toolName, args, creds);
  }
  if (conn.transport === "utcp_http" || conn.transport === "http") {
    let tools = (conn.discoveredTools ?? []) as unknown as ExternalConnectorTool[];
    let toolDef = tools.find((t) => t.name === toolName);
    if (!toolDef && conn.transport === "utcp_http") {
      tools = await discoverUtcpTools(conn.endpointUrl, creds);
      await db
        .update(connectorConnections)
        .set({ discoveredTools: tools.map((t) => ({ ...t })), lastSyncAt: new Date(), updatedAt: new Date() })
        .where(eq(connectorConnections.id, conn.id));
      toolDef = tools.find((t) => t.name === toolName);
    }
    if (toolDef?.callTemplate) {
      return callUtcpTool(conn.endpointUrl, toolDef, args, creds);
    }
    if (conn.transport === "utcp_http") {
      throw new Error(`API tool '${toolName}' not found on connector '${conn.slug}'.`);
    }
    return invokeLiveAdapterTool(conn, toolName, args, creds);
  }
  throw new Error(`Unsupported external bridge transport '${conn.transport}'.`);
}

export async function fireConnectorTrigger(
  db: LuticDatabase,
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
  db: LuticDatabase,
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
