import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  auditLog,
  authorize,
  CONNECTOR_CATALOG,
  connectorConnections,
  desc,
  encryptCredentials,
  eq,
  isCodeModeEnabled,
  isDemoMode,
  listConnectorSyncLogs,
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { sanitizeConnector } from "@/lib/serializers";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const CreateConnectorSchema = z.object({
  name: z.string().min(2).max(160),
  slug: z.string().min(1).max(80).optional(),
  kind: z.string().min(1).max(60).optional(),
  category: z
    .enum(["mcp", "http", "scada", "erp", "messaging", "custom"])
    .optional(),
  transport: z
    .enum(["in_memory_mcp", "kojo_protocol", "remote_mcp", "utcp_http", "http", "webhook", "simulated"])
    .optional(),
  baseUrl: z.string().optional(),
  endpoint: z.string().optional(),
  endpointUrl: z.string().optional(),
  credentials: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional().default({})
});

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "connector:read", { tenantId: user.tenantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [rows, logs] = await Promise.all([
        db
          .select()
          .from(connectorConnections)
          .where(eq(connectorConnections.tenantId, user.tenantId))
          .orderBy(desc(connectorConnections.updatedAt)),
        listConnectorSyncLogs(db, user.tenantId, undefined, 25)
      ]);

      const catalog = isDemoMode() ? CONNECTOR_CATALOG : CONNECTOR_CATALOG
        .filter((entry) =>
          entry.transport === "in_memory_mcp" ||
          entry.transport === "kojo_protocol" ||
          entry.transport === "remote_mcp" ||
          entry.transport === "utcp_http"
        )
        .map((entry) =>
          entry.transport === "remote_mcp" || entry.transport === "utcp_http"
            ? entry
            : {
                ...entry,
                name: `Kojo Local ${entry.slug} adapter`,
                description: `Read or manage Kojo database records with the local ${entry.slug} connector adapter.`,
                credentialFields: [{ key: "endpoint", label: "Kojo Protocol endpoint", defaultValue: `mcp://${entry.slug}` }]
              }
        );
      return NextResponse.json({
        connectors: rows.map(sanitizeConnector),
        catalog,
        logs,
        capabilities: { codeMode: isCodeModeEnabled() }
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
    authorize(user, "connector:write", { tenantId: user.tenantId });

    const body = CreateConnectorSchema.parse(await req.json());
    const id = `conn-hub-${crypto.randomUUID().slice(0, 10)}`;
    const kind = (body.kind ?? body.category ?? "http").toLowerCase();
    const rawSlug =
      body.slug ??
      `${kind}-${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24)}-${crypto.randomUUID().slice(0, 4)}`;

    const category: "mcp" | "http" | "scada" | "erp" | "messaging" | "custom" =
      body.category ??
      (kind === "http" || kind === "webhook"
        ? "http"
        : kind === "scada"
          ? "scada"
          : kind === "erp"
            ? "erp"
            : kind === "messaging"
              ? "messaging"
              : kind === "mcp"
                ? "mcp"
                : "custom");

    const demo = isDemoMode();
    const catalogMatch = CONNECTOR_CATALOG.find((c) => c.slug === kind || c.slug === rawSlug);
    const defaultEndpoint = demo
      ? "mock://custom.local"
      : catalogMatch?.transport === "in_memory_mcp" ? `mcp://${catalogMatch.slug}` : "";
    const endpointUrl = body.endpointUrl ?? body.baseUrl ?? body.endpoint ?? defaultEndpoint;
    const transport:
      | "in_memory_mcp"
      | "kojo_protocol"
      | "remote_mcp"
      | "utcp_http"
      | "http"
      | "webhook"
      | "simulated" =
      body.transport ??
      (kind === "metorial" || kind === "open-connector" || kind === "remote_mcp"
        ? "remote_mcp"
        : kind === "utcp" || kind === "utcp-http" || kind === "utcp_http"
          ? "utcp_http"
          : endpointUrl.startsWith("kojo://")
            ? "kojo_protocol"
            : endpointUrl.startsWith("mcp://")
              ? "in_memory_mcp"
              : endpointUrl.startsWith("mock://") || endpointUrl.startsWith("sim://")
                ? "simulated"
                : category === "http"
                  ? "http"
                  : "simulated");

    const encryptedCredentials = body.credentials
      ? encryptCredentials(body.credentials)
      : "";

    const discoveredTools = demo
      ? catalogMatch?.defaultTools ?? [
        { name: "http_probe", description: "Probe endpoint health" },
        { name: "dispatch_webhook", description: "Send JSON payload" }
      ]
      : [];

    const now = new Date();
    const row = {
      id,
      tenantId: user.tenantId,
      slug: rawSlug,
      name: body.name.trim(),
      category,
      transport,
      endpointUrl,
      status: demo ? "connected" as const : "disconnected" as const,
      encryptedCredentials,
      config: { ...body.config, kind },
      discoveredTools,
      lastSyncAt: demo ? now : null,
      lastError: null,
      createdAt: now,
      updatedAt: now
    };

    return await withWebTenantDb(user.tenantId, async (db) => {
      await db.insert(connectorConnections).values(row);

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "connector_create",
        toolName: "connectors.create",
        args: { connectorId: id, name: row.name, kind, endpointUrl },
        resultHash: "",
        status: "allowed",
        reason: "Connector registered",
        latencyMs: 1
      });

      const sanitized = sanitizeConnector(row);
      return NextResponse.json(
        { id, connectorId: id, connector: sanitized },
        { status: 201 }
      );
    });
  } catch (err) {
    return handleApiError(err);
  }
}
