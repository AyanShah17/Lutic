import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  toolContextStorage,
  type Connector,
  type ConnectorHealth,
  type ConnectorKind,
  type ConnectorToolDefinition,
  type ToolExecutionContext
} from "./types";
import { docsConnector } from "./servers/docs";
import { historianConnector } from "./servers/historian";
import { cmmsConnector } from "./servers/cmms";
import { partsErpConnector } from "./servers/parts-erp";
import { mesConnector } from "./servers/mes";
import { paasConnector } from "./servers/paas";
import type { KojoDatabase } from "@kojo/core";

export const ALL_CONNECTORS: Connector[] = [
  docsConnector,
  historianConnector,
  cmmsConnector,
  partsErpConnector,
  mesConnector
];

export const PAAS_CONNECTORS: Connector[] = [
  ...ALL_CONNECTORS,
  paasConnector
];

interface ConnectedMcpChannel {
  connector: Connector;
  client: Client;
  close: () => Promise<void>;
}

export class McpToolRegistry {
  private channels = new Map<ConnectorKind, ConnectedMcpChannel>();
  private toolMap = new Map<string, ConnectorToolDefinition>();
  private initPromise: Promise<void> | null = null;

  constructor(private readonly connectors: Connector[] = PAAS_CONNECTORS) {
    for (const c of connectors) {
      for (const tool of c.listTools()) {
        this.toolMap.set(tool.name, tool);
      }
    }
  }

  async ensureConnected(): Promise<void> {
    if (this.channels.size === this.connectors.length) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      for (const connector of this.connectors) {
        if (this.channels.has(connector.kind)) continue;
        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        const server = connector.createMcpServer();
        const client = new Client({
          name: `kojo-agent-client-${connector.kind}`,
          version: "0.1.0"
        });
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        this.channels.set(connector.kind, {
          connector,
          client,
          close: async () => {
            await client.close();
            await server.close();
          }
        });
      }
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  listToolDefinitions(): ConnectorToolDefinition[] {
    return Array.from(this.toolMap.values());
  }

  getToolDefinition(name: string): ConnectorToolDefinition | undefined {
    return this.toolMap.get(name);
  }

  getConnector(kind: ConnectorKind): Connector | undefined {
    return this.connectors.find((c) => c.kind === kind);
  }

  async discoverMcpTools(connectorKind?: string): Promise<
    Array<{ connectorKind: ConnectorKind; name: string; description?: string }>
  > {
    await this.ensureConnected();
    const discovered: Array<{
      connectorKind: ConnectorKind;
      name: string;
      description?: string;
    }> = [];
    for (const [kind, ch] of this.channels.entries()) {
      if (connectorKind && kind !== connectorKind) continue;
      const res = await ch.client.listTools();
      for (const t of res.tools) {
        discovered.push({
          connectorKind: kind,
          name: t.name,
          description: t.description
        });
      }
    }
    return discovered;
  }

  async callToolOverMcp(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext
  ): Promise<Record<string, unknown>> {
    const def = this.toolMap.get(toolName);
    if (!def) {
      throw new Error(`Unknown MCP tool '${toolName}'`);
    }
    await this.ensureConnected();
    const channel = this.channels.get(def.connectorKind);
    if (!channel) {
      throw new Error(`MCP channel not connected for '${def.connectorKind}'`);
    }

    const mcpResult = await toolContextStorage.run(ctx, async () => {
      return await channel.client.callTool({
        name: toolName,
        arguments: args
      });
    });

    const content = Array.isArray(mcpResult.content) ? mcpResult.content : [];
    const firstText = content.find(
      (item): item is { type: "text"; text: string } =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "text" &&
        "text" in item
    );

    if (!firstText) {
      return { ok: !mcpResult.isError };
    }

    if (mcpResult.isError) {
      throw new Error(firstText.text);
    }

    return JSON.parse(firstText.text) as Record<string, unknown>;
  }

  async healthChecks(
    db: KojoDatabase,
    tenantId: string
  ): Promise<ConnectorHealth[]> {
    return Promise.all(
      this.connectors.map((c) => c.healthCheck(db, tenantId))
    );
  }

  async closeAll(): Promise<void> {
    for (const ch of this.channels.values()) {
      await ch.close();
    }
    this.channels.clear();
  }
}

export const defaultMcpRegistry = new McpToolRegistry();
