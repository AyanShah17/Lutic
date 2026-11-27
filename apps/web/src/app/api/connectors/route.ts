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
} from "@lutic/core";
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
    .enum(["in_memory_mcp", "lutic_protocol", "remote_mcp", "utcp_http", "http", "webhook", "simulated"])
    .optional(),
  baseUrl: z.string().optional(),
  endpoint: z.string().optional(),
  endpointUrl: z.string().optional(),
  authScheme: z
    .enum(["oauth2", "api_key", "bearer", "basic", "remote_mcp", "openapi", "protocol"])
    .optional(),
  credentials: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional().default({})
});

const LEGACY_INTERNAL_SLUGS = new Set([
  "cmms",
  "historian",
  "mes",
  "parts-erp",
  "docs",
  "ops-webhook",
  "lutic-cloud",
  "lutic-bridge",
  "lutic-api"
]);

function isPlaceholderUrl(url: string): boolean {
  const clean = url.trim().toLowerCase();
  if (!clean) return true;
  if (clean.startsWith("mock://") || clean.startsWith("sim://")) return true;
  try {
    const host = new URL(clean).hostname.toLowerCase();
    return (
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".example") ||
      host.endsWith(".example.com") ||
      host.endsWith(".invalid")
    );
  } catch {
    return true;
  }
}

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

      const isInternal = (r: { transport: string; slug: string }) =>
        r.transport === "in_memory_mcp" || LEGACY_INTERNAL_SLUGS.has(r.slug.toLowerCase());
      const visibleRows = rows.filter((r) => !isInternal(r));
      const hiddenIds = new Set(rows.filter(isInternal).map((r) => r.id));
      const visibleLogs = logs.filter((l) => !hiddenIds.has(l.connectionId));

      const catalog = CONNECTOR_CATALOG;
      return NextResponse.json({
        connectors: visibleRows.map(sanitizeConnector),
        catalog,
        logs: visibleLogs,
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

    const catalogMatch = CONNECTOR_CATALOG.find(
      (c) =>
        (body.slug && c.slug === body.slug.toLowerCase()) ||
        (kind !== "http" && c.slug === kind) ||
        c.slug === rawSlug
    );

    const category: "mcp" | "http" | "scada" | "erp" | "messaging" | "custom" =
      body.category ??
      catalogMatch?.category ??
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
    const defaultEndpoint = demo
      ? (catalogMatch?.credentialFields?.find((f) => f.key === "endpointUrl" || f.key === "endpoint")?.defaultValue ?? "mock://custom.local")
      : catalogMatch?.transport === "in_memory_mcp"
        ? `mcp://${catalogMatch.slug}`
        : "";
    const explicitEndpoint = body.endpointUrl ?? body.baseUrl ?? body.endpoint;
    const hasExplicitUrl = Boolean(explicitEndpoint && explicitEndpoint.trim().length > 0);
    const endpointUrl = explicitEndpoint ?? defaultEndpoint;
    const hasRealCredentials = Boolean(
      body.credentials &&
        Object.entries(body.credentials).some(
          ([k, v]) => k !== "authScheme" && k !== "headerName" && typeof v === "string" && v.trim().length > 0
        )
    );
    const hasLiveUrl = !isPlaceholderUrl(endpointUrl);

    const transport:
      | "in_memory_mcp"
      | "lutic_protocol"
      | "remote_mcp"
      | "utcp_http"
      | "http"
      | "webhook"
      | "simulated" =
      body.transport ??
      (body.authScheme === "remote_mcp" ||
      rawSlug.endsWith("-mcp") ||
      kind === "metorial" ||
      kind === "open-connector" ||
      kind === "remote_mcp"
        ? "remote_mcp"
        : body.authScheme === "openapi" ||
            kind === "utcp" ||
            kind === "utcp-http" ||
            kind === "utcp_http"
          ? "utcp_http"
          : endpointUrl.startsWith("lutic://")
            ? "lutic_protocol"
            : endpointUrl.startsWith("mcp://")
              ? "in_memory_mcp"
              : endpointUrl.startsWith("mock://") || endpointUrl.startsWith("sim://")
                ? "simulated"
                : hasRealCredentials || (hasExplicitUrl && hasLiveUrl)
                  ? "http"
                  : catalogMatch && catalogMatch.slug !== "http"
                    ? catalogMatch.transport
                    : category === "http"
                      ? "http"
                      : "simulated");

    const credsPayload = body.credentials
      ? {
          ...(body.authScheme ? { authScheme: body.authScheme } : {}),
          ...body.credentials
        }
      : undefined;
    const encryptedCredentials = credsPayload
      ? encryptCredentials(credsPayload)
      : "";

    const discoveredTools =
      transport === "remote_mcp" || transport === "utcp_http"
        ? []
        : demo || (transport === "http" && hasRealCredentials && catalogMatch)
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
      status: demo || (hasRealCredentials && hasLiveUrl) ? ("connected" as const) : ("disconnected" as const),
      encryptedCredentials,
      config: {
        ...body.config,
        kind,
        ...(body.authScheme ? { authScheme: body.authScheme } : {})
      },
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
