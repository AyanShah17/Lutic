"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Lock,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
  Zap
} from "lucide-react";
import {
  AUTH_SCHEME_LABELS,
  getConnectorAuthBlueprint,
  type ConnectorAuthScheme
} from "@lutic/core/connector-blueprints";
import { useAppContext } from "./providers";
import { AuthGate } from "./ui/auth-gate";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Textarea } from "./ui/textarea";
import { SpotlightNavbar } from "./vengeance/spotlight-navbar";

interface ConnectorHubItem {
  id: string;
  slug: string;
  kind: string;
  name: string;
  category: string;
  transport: string;
  endpointUrl: string;
  status: string;
  hasCredentials: boolean;
  config?: Record<string, unknown>;
  discoveredTools: Array<{ name: string; description?: string }>;
  lastSyncAt: string | null;
  lastError: string | null;
}

interface CatalogItem {
  slug: string;
  name: string;
  category: string;
  transport: string;
  description: string;
  credentialFields?: Array<{ key: string; label: string; secret?: boolean; defaultValue?: string }>;
}

interface SyncLogItem {
  id: string;
  connectionId: string;
  direction: string;
  status: string;
  recordsSynced: number;
  latencyMs: number;
  message: string;
  createdAt: string;
}

const FEATURED_SLUGS = [
  "github",
  "slack",
  "linear",
  "jira",
  "notion",
  "stripe",
  "hubspot",
  "discord",
  "google-drive",
  "gmail",
  "servicenow",
  "sap-pm"
];

function statusBadgeVariant(status: string): "success" | "warning" | "destructive" | "outline" {
  if (status === "connected" || status === "success") return "success";
  if (status === "degraded" || status === "partial") return "warning";
  if (status === "error" || status === "failed") return "destructive";
  return "outline";
}

function formatTransportLabel(transport: string): string {
  switch (transport) {
    case "remote_mcp":
      return "Remote MCP";
    case "utcp_http":
      return "OpenAPI Spec";
    case "in_memory_mcp":
      return "Local MCP";
    case "lutic_protocol":
      return "Direct Protocol";
    case "simulated":
      return "Sandbox Adapter";
    case "http":
      return "HTTPS API";
    default:
      return transport;
  }
}

function formatAuthSchemeLabel(conn: ConnectorHubItem): string {
  const cfgScheme = typeof conn.config?.authScheme === "string" ? conn.config.authScheme : "";
  if (cfgScheme && cfgScheme in AUTH_SCHEME_LABELS) {
    return AUTH_SCHEME_LABELS[cfgScheme as ConnectorAuthScheme];
  }
  if (conn.transport === "remote_mcp") return "Remote MCP";
  if (conn.transport === "utcp_http") return "OpenAPI Spec";
  if (conn.transport === "in_memory_mcp") return "Native";
  return conn.hasCredentials ? "Vault Secret" : "Sandbox";
}

export function getConnectorRuntimeTier(entry: {
  slug?: string;
  transport: string;
  endpointUrl?: string;
}): "Native" | "Live Protocol" | "HTTPS Bridge" | "Bridge Template" {
  if (entry.transport === "in_memory_mcp" || entry.transport === "lutic_protocol") {
    return "Native";
  }
  if (entry.transport === "remote_mcp" || entry.transport === "utcp_http") {
    return "HTTPS Bridge";
  }
  const slug = String(entry.slug ?? "").toLowerCase();
  const url = String(entry.endpointUrl ?? "").toLowerCase();
  if (
    url.startsWith("modbus://") ||
    url.startsWith("mqtt://") ||
    url.startsWith("mqtts://") ||
    [
      "servicenow",
      "sap-pm",
      "sap-mm",
      "sap-pp",
      "sap-qm",
      "jira",
      "linear",
      "slack",
      "github",
      "notion",
      "stripe",
      "discord",
      "hubspot"
    ].some((s) => slug === s || slug.startsWith(`${s}-`))
  ) {
    return "Live Protocol";
  }
  return "Bridge Template";
}

export function isConnectorSupportedInRuntime(
  connector: { slug?: string; transport: string; endpointUrl: string; hasCredentials?: boolean },
  demoEnabled: boolean
): boolean {
  if (demoEnabled) return true;
  if (connector.transport === "remote_mcp" || connector.transport === "utcp_http") {
    return /^https:\/\//i.test(connector.endpointUrl.trim());
  }
  if (/^(?:modbus|mqtts?):\/\/[^/\s]+/i.test(connector.endpointUrl.trim())) {
    return !/\.(?:local|internal|example|invalid)(?:[:/]|$)/i.test(connector.endpointUrl);
  }
  const slug = String(connector.slug ?? "").toLowerCase();
  const isKnownRest = [
    "servicenow",
    "sap-pm",
    "sap-mm",
    "sap-pp",
    "sap-qm",
    "jira",
    "linear",
    "slack",
    "github",
    "notion",
    "stripe",
    "discord",
    "hubspot"
  ].some((s) => slug === s || slug.startsWith(`${s}-`));

  if (
    (isKnownRest || (connector.transport === "http" && Boolean(connector.hasCredentials))) &&
    /^https:\/\//i.test(connector.endpointUrl.trim())
  ) {
    return !/\.(?:local|internal|example|invalid)(?:[:/]|$)/i.test(connector.endpointUrl);
  }
  return (
    (connector.transport === "in_memory_mcp" || connector.transport === "lutic_protocol") &&
    /^(?:lutic|mcp):\/\/([a-z-]+)$/.test(connector.endpointUrl.trim())
  );
}

export function ConnectorsConsole() {
  const { user, demoEnabled } = useAppContext();
  const [connectors, setConnectors] = useState<ConnectorHubItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [logs, setLogs] = useState<SyncLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState("connections");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [toolName, setToolName] = useState("");
  const [toolArgs, setToolArgs] = useState('{"machineId": "mach-l3-filler-01", "limit": 5}');
  const [playgroundMode, setPlaygroundMode] = useState<"tool" | "code">("tool");
  const [codeModeEnabled, setCodeModeEnabled] = useState(false);
  const [codeScript, setCodeScript] = useState(
    'const st = await lutic.callTool("get_machine_status", { machineId: input.machineId });\nreturn { machineId: input.machineId, status: st.status };'
  );
  const [invokeOutput, setInvokeOutput] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [planUsage, setPlanUsage] = useState<{ plan: string; connectors: number; maxConnectors: number } | null>(null);

  const CATALOG_PAGE_SIZE = 60;
  const [visibleCatalogCount, setVisibleCatalogCount] = useState(CATALOG_PAGE_SIZE);

  // Per-integration Auth Blueprint & Connected Account Dialog State
  const [connectOpen, setConnectOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [selectedApp, setSelectedApp] = useState<CatalogItem | null>(null);
  const [activeScheme, setActiveScheme] = useState<ConnectorAuthScheme>("api_key");
  const [connectionLabel, setConnectionLabel] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthCustomAuthUrl, setOauthCustomAuthUrl] = useState("");
  const [oauthCustomTokenUrl, setOauthCustomTokenUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [originUrl, setOriginUrl] = useState("");

  const isAdmin = user?.role === "admin";

  const load = async (selectIdAfter?: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/connectors", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          connectors: ConnectorHubItem[];
          catalog: CatalogItem[];
          logs: SyncLogItem[];
          plan?: string;
          usage?: { connectors: number; maxConnectors: number };
          capabilities?: { codeMode?: boolean };
        };
        const list = data.connectors ?? [];
        setConnectors(list);
        setCatalog(data.catalog ?? []);
        setLogs(data.logs ?? []);
        if (data.usage) {
          setPlanUsage({
            plan: data.plan ?? "free",
            connectors: data.usage.connectors,
            maxConnectors: data.usage.maxConnectors
          });
        }
        setCodeModeEnabled(data.capabilities?.codeMode === true);
        setSelectedId((prev) => {
          if (selectIdAfter && list.some((c) => c.id === selectIdAfter)) {
            const match = list.find((c) => c.id === selectIdAfter);
            if (match) setToolName(match.discoveredTools?.[0]?.name ?? "");
            return selectIdAfter;
          }
          const stillExists = prev && list.some((c) => c.id === prev);
          if (stillExists) return prev;
          const first = list[0];
          if (first) {
            setToolName(first.discoveredTools?.[0]?.name ?? "");
            return first.id;
          }
          return null;
        });
      } else {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setLoadError(err.detail ?? "Failed to load connectors");
      }
    } catch {
      setLoadError("Failed to load connectors");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined" && window.location) {
      setOriginUrl(window.location.origin ?? "");
      const qp = new URLSearchParams(window.location.search ?? "");
      const connectedName = qp.get("connected");
      const oauthErr = qp.get("oauth_error");
      if (connectedName) {
        setNotice(`Connected ${connectedName} via OAuth 2.0 + PKCE vault.`);
      } else if (oauthErr) {
        setNotice(`OAuth error: ${oauthErr}`);
      }
    }
    if (user) void load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const openAppConnect = (app: CatalogItem) => {
    const bp = getConnectorAuthBlueprint(app);
    const defaults: Record<string, string> = {};
    for (const f of bp.fieldsByScheme[bp.defaultScheme] ?? []) {
      defaults[f.key] = f.defaultValue ?? "";
    }
    setSelectedApp(app);
    setActiveScheme(bp.defaultScheme);
    setConnectionLabel(app.name);
    setFieldValues(defaults);
    setOauthClientId("");
    setOauthClientSecret("");
    setOauthCustomAuthUrl(bp.oauthProvider?.authorizationUrl ?? "");
    setOauthCustomTokenUrl(bp.oauthProvider?.tokenUrl ?? "");
    setConnectError(null);
    setConnectOpen(true);
  };

  const openNewConnectionPicker = () => {
    setSelectedApp(null);
    setPickerSearch("");
    setConnectError(null);
    setConnectOpen(true);
  };

  const switchAuthScheme = (scheme: ConnectorAuthScheme) => {
    if (!selectedApp) return;
    const bp = getConnectorAuthBlueprint(selectedApp);
    const nextFields: Record<string, string> = {};
    for (const f of bp.fieldsByScheme[scheme] ?? []) {
      nextFields[f.key] = fieldValues[f.key] || f.defaultValue || "";
    }
    setActiveScheme(scheme);
    setFieldValues(nextFields);
    setConnectError(null);
  };

  const blueprint = useMemo(
    () => (selectedApp ? getConnectorAuthBlueprint(selectedApp) : null),
    [selectedApp]
  );

  const pickerCatalog = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) {
      const featured = FEATURED_SLUGS.map((slug) =>
        catalog.find((c) => c.slug === slug)
      ).filter((c): c is CatalogItem => Boolean(c));
      return featured.length > 0 ? featured : catalog.slice(0, 12);
    }
    return catalog
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q)
      )
      .slice(0, 18);
  }, [catalog, pickerSearch]);

  const selected = useMemo(
    () => connectors.find((c) => c.id === selectedId) ?? connectors[0] ?? null,
    [connectors, selectedId]
  );

  const categories = useMemo(() => {
    const set = new Set<string>([
      ...connectors.map((c) => c.category || "mcp"),
      ...catalog.map((c) => c.category || "mcp")
    ]);
    return ["all", ...Array.from(set)];
  }, [connectors, catalog]);

  const filteredConnectors = useMemo(() => {
    const q = search.trim().toLowerCase();
    return connectors.filter((c) => {
      if (categoryFilter !== "all" && (c.category || "mcp") !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q) ||
        c.kind.toLowerCase().includes(q) ||
        (c.discoveredTools ?? []).some((t) => t.name.toLowerCase().includes(q))
      );
    });
  }, [connectors, categoryFilter, search]);

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((cat) => {
      if (categoryFilter !== "all" && (cat.category || "mcp") !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        cat.name.toLowerCase().includes(q) ||
        cat.slug.toLowerCase().includes(q) ||
        cat.description.toLowerCase().includes(q)
      );
    });
  }, [catalog, categoryFilter, search]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        l.direction.toLowerCase().includes(q) ||
        l.status.toLowerCase().includes(q) ||
        l.message.toLowerCase().includes(q)
    );
  }, [logs, search]);

  useEffect(() => {
    setVisibleCatalogCount(CATALOG_PAGE_SIZE);
  }, [search, categoryFilter]);

  if (!user) {
    return (
      <AuthGate
        title="Sign in to view Connectors Hub"
        description="Connected accounts, OAuth integrations, MCP servers, and API bridges require authentication."
      />
    );
  }

  const handleOAuthAuthorize = async () => {
    if (!selectedApp || !isAdmin) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch("/api/connectors/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: selectedApp.slug,
          name: connectionLabel.trim() || selectedApp.name,
          endpointUrl: blueprint?.defaultEndpointUrl,
          clientId: oauthClientId.trim() || undefined,
          clientSecret: oauthClientSecret.trim() || undefined,
          authorizationUrl: oauthCustomAuthUrl.trim() || undefined,
          tokenUrl: oauthCustomTokenUrl.trim() || undefined
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        authorizationUrl?: string;
        detail?: string;
      };
      if (!res.ok || !data.authorizationUrl) {
        setConnectError(data.detail ?? "Unable to start OAuth authorization flow.");
        return;
      }
      window.location.assign(data.authorizationUrl);
    } catch {
      setConnectError("Failed to initiate OAuth handshake.");
    } finally {
      setConnecting(false);
    }
  };

  const handleDirectConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApp || !isAdmin) return;
    setConnecting(true);
    setConnectError(null);

    const endpointUrl = (fieldValues.endpointUrl ?? blueprint?.defaultEndpointUrl ?? "").trim();
    const credentials: Record<string, unknown> = { authScheme: activeScheme };
    for (const [k, v] of Object.entries(fieldValues)) {
      if (k !== "endpointUrl" && v.trim()) {
        credentials[k] = v.trim();
      }
    }

    try {
      const res = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: connectionLabel.trim() || selectedApp.name,
          kind: selectedApp.slug,
          authScheme: activeScheme,
          endpointUrl: endpointUrl || undefined,
          credentials
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        detail?: string;
      };
      if (!res.ok || !data.id) {
        setConnectError(data.detail ?? "Failed to save connected account.");
        return;
      }

      if (activeScheme === "remote_mcp" || activeScheme === "openapi") {
        await fetch(`/api/connectors/${data.id}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        }).catch(() => {});
      }

      setNotice(
        `Connected ${connectionLabel.trim() || selectedApp.name} (${AUTH_SCHEME_LABELS[activeScheme]} stored in AES-256-GCM vault).`
      );
      setConnectOpen(false);
      setViewTab("connections");
      await load(data.id);
    } catch {
      setConnectError("Connection request failed.");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (conn: ConnectorHubItem) => {
    try {
      const res = await fetch(`/api/connectors/${conn.id}`, { method: "DELETE" });
      if (res.ok) {
        setNotice(`Disconnected ${conn.name}.`);
        setInvokeOutput(null);
        await load();
      } else {
        const d = (await res.json().catch(() => ({}))) as { detail?: string };
        setNotice(d.detail ?? `Unable to disconnect ${conn.name}.`);
      }
    } catch {
      setNotice("Disconnect request failed.");
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-border/70 pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Plug className="h-5 w-5 text-primary" />
            <span>Connectors Hub</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect OAuth 2.0 apps, API keys, remote MCP servers, and OpenAPI tools into an encrypted per-workspace vault.
          </p>
          {planUsage && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-mono text-muted-foreground">
              <span>
                {planUsage.connectors}/{planUsage.maxConnectors} connectors on{" "}
                {planUsage.plan} plan
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 min-w-[180px] sm:flex-initial">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search connectors, tools, logs..."
              aria-label="Search connectors"
              className="pl-8 w-full sm:w-56"
            />
          </div>
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter connector category"
            className="w-full sm:w-auto"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === "all" ? "All Categories" : cat.toUpperCase()}
              </option>
            ))}
          </Select>
          {isAdmin && (
            <Button size="sm" onClick={openNewConnectionPicker} className="shrink-0">
              <Plus className="h-3.5 w-3.5" />
              <span>New Connection</span>
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <div className="rounded-md border border-border bg-muted/60 px-3.5 py-2 text-xs font-medium flex items-center justify-between gap-2 min-w-0">
          <span className="min-w-0 break-words">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss connector notice"
            className="shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!loading && loadError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive flex items-center justify-between gap-3 min-w-0"
        >
          <span className="min-w-0 break-words">{loadError}</span>
          <Button variant="outline" size="sm" onClick={() => void load()} className="shrink-0">
            Retry
          </Button>
        </div>
      )}

      <SpotlightNavbar
        activeId={viewTab}
        onSelect={setViewTab}
        items={[
          { id: "connections", label: "Active Connections", badge: filteredConnectors.length },
          { id: "catalog", label: "Catalog", badge: filteredCatalog.length },
          { id: "logs", label: "Sync & Invoke Logs", badge: filteredLogs.length }
        ]}
      />

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-36 rounded-lg border border-border bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {viewTab === "connections" && (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-3 min-w-0">
                {filteredConnectors.length === 0 ? (
                  <Card className="p-8 text-center text-xs text-muted-foreground space-y-3">
                    <div>
                      {connectors.length === 0
                        ? (loadError ?? "No connected accounts in this workspace yet.")
                        : "No connectors match your search."}
                    </div>
                    {isAdmin && connectors.length === 0 && (
                      <Button size="sm" onClick={openNewConnectionPicker}>
                        <Plus className="h-3.5 w-3.5" />
                        <span>Connect First App</span>
                      </Button>
                    )}
                  </Card>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {filteredConnectors.map((c) => (
                      <Card
                        key={c.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Select connector ${c.name}`}
                        aria-pressed={selected?.id === c.id}
                        onClick={() => {
                          setSelectedId(c.id);
                          setToolName(c.discoveredTools?.[0]?.name ?? "");
                          setInvokeOutput(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedId(c.id);
                            setToolName(c.discoveredTools?.[0]?.name ?? "");
                            setInvokeOutput(null);
                          }
                        }}
                        className={`cursor-pointer p-3.5 space-y-1.5 transition-colors min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                          selected?.id === c.id
                            ? "border-primary/70 ring-1 ring-primary/40 bg-muted/20"
                            : "hover:border-foreground/25"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-sm text-foreground truncate">{c.name}</div>
                            <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                              {formatAuthSchemeLabel(c)} · {formatTransportLabel(c.transport)} ·{" "}
                              {(c.discoveredTools ?? []).length} tool
                              {(c.discoveredTools ?? []).length === 1 ? "" : "s"}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <Badge variant={statusBadgeVariant(c.status)} className="capitalize text-[10px]">
                              {c.status === "connected" && <CheckCircle2 className="h-3 w-3" />}
                              <span>{c.status}</span>
                            </Badge>
                          </div>
                        </div>

                        {c.lastError && (
                          <div className="text-[11px] text-destructive line-clamp-2">
                            {c.lastError}
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              <aside className="space-y-4 min-w-0">
                {selected && (
                  <Card className="p-4 space-y-4">
                    <div className="flex items-start justify-between gap-2 border-b border-border/70 pb-3">
                      <div className="min-w-0 space-y-1">
                        <div className="text-sm font-semibold truncate">{selected.name}</div>
                        <div className="text-[11px] font-mono text-muted-foreground truncate">
                          {formatTransportLabel(selected.transport)} · {selected.endpointUrl || "in-memory"}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {formatAuthSchemeLabel(selected)}
                          </Badge>
                          {selected.hasCredentials && (
                            <Badge variant="secondary" className="text-[10px] gap-1">
                              <Lock className="h-2.5 w-2.5" />
                              <span>AES-256-GCM Vault</span>
                            </Badge>
                          )}
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!isConnectorSupportedInRuntime(selected, demoEnabled)}
                            onClick={async () => {
                              try {
                                const res = await fetch(`/api/connectors/${selected.id}/test`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({})
                                });
                                const d = (await res.json().catch(() => ({}))) as {
                                  message?: string;
                                  status?: string;
                                  detail?: string;
                                };
                                setNotice(
                                  res.ok
                                    ? `Health test (${selected.slug}): ${d.status ?? "ok"} — ${d.message ?? ""}`
                                    : d.detail ?? `Health test failed for ${selected.slug}`
                                );
                                await load(selected.id);
                              } catch {
                                setNotice(`Health test request failed for ${selected.slug}`);
                              }
                            }}
                          >
                            <Activity className="h-3 w-3" />
                            <span>Test</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!isConnectorSupportedInRuntime(selected, demoEnabled)}
                            onClick={async () => {
                              try {
                                const res = await fetch(`/api/connectors/${selected.id}/sync`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({})
                                });
                                const d = (await res.json().catch(() => ({}))) as {
                                  tools?: unknown[];
                                  detail?: string;
                                };
                                setNotice(
                                  res.ok
                                    ? `Synced ${selected.slug}: ${d.tools?.length ?? 0} tool(s)`
                                    : d.detail ?? `Sync failed for ${selected.slug}`
                                );
                                await load(selected.id);
                              } catch {
                                setNotice(`Sync request failed for ${selected.slug}`);
                              }
                            }}
                          >
                            <RefreshCw className="h-3 w-3" />
                            <span>Sync</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Disconnect ${selected.name}`}
                            onClick={() => void handleDisconnect(selected)}
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium text-muted-foreground">
                        Discovered Tools ({selected.discoveredTools.length})
                      </div>
                      <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto">
                        {selected.discoveredTools.map((t) => (
                          <button
                            key={t.name}
                            type="button"
                            onClick={() => {
                              setToolName(t.name);
                              setPlaygroundMode("tool");
                            }}
                            title={t.description || t.name}
                            className={`rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
                              toolName === t.name && playgroundMode === "tool"
                                ? "border-primary/60 bg-primary/10 text-foreground"
                                : "border-border/80 bg-muted/35 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {t.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {isAdmin && (
                      <div className="space-y-3 border-t border-border/70 pt-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 text-xs font-semibold">
                            <Zap className="h-3.5 w-3.5 text-primary" />
                            <span>Tool Playground</span>
                          </div>
                          <div className="inline-flex rounded-lg border border-border/75 bg-muted/40 p-0.5 text-[11px]">
                            <button
                              type="button"
                              onClick={() => setPlaygroundMode("tool")}
                              className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                                playgroundMode === "tool"
                                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              Standard Tool
                            </button>
                            <button
                              type="button"
                              onClick={() => setPlaygroundMode("code")}
                              disabled={!codeModeEnabled}
                              title={
                                codeModeEnabled
                                  ? undefined
                                  : "Code Mode is available only in trusted development and tests"
                              }
                              className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                                playgroundMode === "code"
                                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                                  : "text-muted-foreground hover:text-foreground"
                              } disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                              Lutic Code Mode
                            </button>
                          </div>
                        </div>

                        {playgroundMode === "tool" ? (
                          <div className="space-y-1">
                            <Label htmlFor="connector-tool-name">Tool Name</Label>
                            <Input
                              id="connector-tool-name"
                              value={toolName}
                              onChange={(e) => setToolName(e.target.value)}
                              placeholder="e.g. get_work_orders"
                              className="font-mono"
                            />
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <Label htmlFor="connector-code-script">
                              Isolated Code Mode Script (<code className="font-mono">lutic.callTool / lutic.connectors</code>)
                            </Label>
                            <Textarea
                              id="connector-code-script"
                              rows={4}
                              value={codeScript}
                              onChange={(e) => setCodeScript(e.target.value)}
                              className="font-mono text-xs"
                            />
                          </div>
                        )}

                        <div className="space-y-1">
                          <Label htmlFor="connector-tool-args">
                            {playgroundMode === "code" ? "Script Input (JSON)" : "Arguments (JSON)"}
                          </Label>
                          <Textarea
                            id="connector-tool-args"
                            rows={3}
                            value={toolArgs}
                            onChange={(e) => setToolArgs(e.target.value)}
                            className="font-mono"
                          />
                        </div>

                        {!codeModeEnabled && (
                          <div className="rounded-md border border-amber-500/35 bg-amber-500/10 p-2 text-[11px] text-amber-900 dark:text-amber-200">
                            Code Mode is available only in trusted development and tests. Use governed standard tool invocation.
                          </div>
                        )}

                        <Button
                          size="sm"
                          disabled={
                            (playgroundMode === "code" && !codeModeEnabled) ||
                            (playgroundMode === "tool" && !isConnectorSupportedInRuntime(selected, demoEnabled))
                          }
                          onClick={async () => {
                            let parsed: Record<string, unknown>;
                            try {
                              parsed = JSON.parse(toolArgs || "{}") as Record<string, unknown>;
                            } catch {
                              setInvokeOutput("Invalid JSON arguments");
                              return;
                            }
                            try {
                              const payload =
                                playgroundMode === "code"
                                  ? { mode: "code", code: codeScript, args: parsed }
                                  : { toolName, args: parsed };
                              const res = await fetch(`/api/connectors/${selected.id}/invoke`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(payload)
                              });
                              const data = await res.json().catch(() => ({
                                detail: `Invocation failed (${res.status})`
                              }));
                              setInvokeOutput(JSON.stringify(data, null, 2));
                              await load(selected.id);
                            } catch {
                              setInvokeOutput("Connector invocation request failed");
                            }
                          }}
                        >
                          <Play className="h-3.5 w-3.5" />
                          <span>{playgroundMode === "code" ? "Run Code Mode" : "Invoke Tool"}</span>
                        </Button>

                        {invokeOutput && (
                          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-2.5 text-[11px] font-mono">
                            {invokeOutput}
                          </pre>
                        )}
                      </div>
                    )}
                  </Card>
                )}
              </aside>
            </div>
          )}

          {/* Per-Integration Auth Blueprint & Connected Account Dialog */}
          <Dialog
            open={connectOpen}
            onOpenChange={setConnectOpen}
            ariaLabel={selectedApp ? `Connect ${selectedApp.name}` : "New connected account"}
            className="max-w-lg p-5 space-y-4"
          >
            {!selectedApp ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">Connect an Integration</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Pick an app, remote MCP server, or OpenAPI spec to configure its auth flow.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setConnectOpen(false)}
                    aria-label="Close connection picker"
                    className="h-8 w-8"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-3 top-3 text-muted-foreground" />
                  <Input
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    placeholder="Search 2,100+ integrations (GitHub, Slack, Linear, Jira, Stripe, SAP)..."
                    aria-label="Search integrations"
                    className="pl-8"
                  />
                </div>

                <div className="grid gap-2 sm:grid-cols-2 max-h-80 overflow-y-auto pr-1">
                  {pickerCatalog.map((item) => {
                    const bp = getConnectorAuthBlueprint(item);
                    return (
                      <button
                        key={item.slug}
                        type="button"
                        onClick={() => openAppConnect(item)}
                        className="text-left rounded-xl border border-border bg-card p-3 hover:border-primary/60 hover:bg-muted/30 transition-colors space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground truncate">
                            {item.name}
                          </span>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {AUTH_SCHEME_LABELS[bp.defaultScheme]}
                          </Badge>
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground truncate">
                          {item.slug} · {bp.supportedSchemes.map((s) => AUTH_SCHEME_LABELS[s]).join(" / ")}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              blueprint && (
                <>
                  <div className="flex items-start justify-between gap-2 border-b border-border/70 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-semibold">Connect {selectedApp.name}</h2>
                        <Badge variant="secondary" className="uppercase text-[10px]">
                          {selectedApp.category}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {blueprint.notes || selectedApp.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedApp(null)}
                        className="text-xs"
                      >
                        Change
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setConnectOpen(false)}
                        aria-label="Close connection dialog"
                        className="h-8 w-8"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Auth Scheme Tabs (OAuth 2.0 / API Key / Bearer / Basic / Remote MCP / OpenAPI) */}
                  <div className="space-y-1.5">
                    <Label>Authentication Method</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {blueprint.supportedSchemes.map((scheme) => (
                        <button
                          key={scheme}
                          type="button"
                          onClick={() => switchAuthScheme(scheme)}
                          className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                            activeScheme === scheme
                              ? "border-foreground bg-foreground text-background"
                              : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {AUTH_SCHEME_LABELS[scheme]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {connectError && (
                    <div
                      role="alert"
                      className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                    >
                      {connectError}
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label htmlFor="conn-account-label">Connected Account Name</Label>
                    <Input
                      id="conn-account-label"
                      value={connectionLabel}
                      onChange={(e) => setConnectionLabel(e.target.value)}
                      placeholder={`My ${selectedApp.name}`}
                    />
                  </div>

                  {activeScheme === "oauth2" ? (
                    <div className="space-y-3 rounded-xl border border-border bg-muted/25 p-3.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium flex items-center gap-1.5">
                          <KeyRound className="h-3.5 w-3.5 text-primary" />
                          <span>OAuth 2.0 + PKCE Consent Flow</span>
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">S256</span>
                      </div>

                      {originUrl && (
                        <div className="text-[11px] text-muted-foreground">
                          Redirect URI:{" "}
                          <code className="font-mono text-foreground">
                            {originUrl}/api/connectors/oauth/callback
                          </code>
                        </div>
                      )}

                      {!blueprint.oauthProvider && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label htmlFor="oauth-auth-url">Authorization URL</Label>
                            <Input
                              id="oauth-auth-url"
                              placeholder="https://provider.com/oauth/authorize"
                              value={oauthCustomAuthUrl}
                              onChange={(e) => setOauthCustomAuthUrl(e.target.value)}
                              className="font-mono text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="oauth-token-url">Token URL</Label>
                            <Input
                              id="oauth-token-url"
                              placeholder="https://provider.com/oauth/token"
                              value={oauthCustomTokenUrl}
                              onChange={(e) => setOauthCustomTokenUrl(e.target.value)}
                              className="font-mono text-xs"
                            />
                          </div>
                        </div>
                      )}

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor="oauth-client-id">OAuth Client ID</Label>
                          <Input
                            id="oauth-client-id"
                            placeholder="Optional if server env configured"
                            value={oauthClientId}
                            onChange={(e) => setOauthClientId(e.target.value)}
                            className="font-mono text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="oauth-client-secret">OAuth Client Secret</Label>
                          <Input
                            id="oauth-client-secret"
                            type="password"
                            placeholder="Optional for public PKCE apps"
                            value={oauthClientSecret}
                            onChange={(e) => setOauthClientSecret(e.target.value)}
                            className="font-mono text-xs"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <Button variant="outline" size="sm" onClick={() => setConnectOpen(false)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          disabled={connecting}
                          onClick={() => void handleOAuthAuthorize()}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>
                            {connecting ? "Redirecting..." : `Authorize ${selectedApp.name}`}
                          </span>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleDirectConnect} className="space-y-3">
                      {(blueprint.fieldsByScheme[activeScheme] ?? []).map((field) => (
                        <div key={field.key} className="space-y-1">
                          <Label htmlFor={`conn-field-${field.key}`}>{field.label}</Label>
                          <Input
                            id={`conn-field-${field.key}`}
                            type={field.secret ? "password" : "text"}
                            required={field.required}
                            placeholder={field.placeholder ?? field.defaultValue ?? ""}
                            value={fieldValues[field.key] ?? ""}
                            onChange={(e) =>
                              setFieldValues((prev) => ({
                                ...prev,
                                [field.key]: e.target.value
                              }))
                            }
                            className="font-mono text-xs"
                          />
                        </div>
                      ))}

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60">
                        <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                          <Lock className="h-3 w-3 text-primary" />
                          <span>Encrypted with AES-256-GCM</span>
                        </span>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setConnectOpen(false)}>
                            Cancel
                          </Button>
                          <Button type="submit" size="sm" disabled={connecting}>
                            <span>
                              {connecting ? "Connecting..." : `Connect ${selectedApp.name}`}
                            </span>
                          </Button>
                        </div>
                      </div>
                    </form>
                  )}
                </>
              )
            )}
          </Dialog>

          {viewTab === "catalog" && (
            filteredCatalog.length === 0 ? (
              <Card className="p-8 text-center text-xs text-muted-foreground">
                {catalog.length === 0
                  ? "No connector templates available."
                  : "No catalog templates match your search."}
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Showing {Math.min(visibleCatalogCount, filteredCatalog.length).toLocaleString()} of{" "}
                    {filteredCatalog.length.toLocaleString()} distinct connectors
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredCatalog.slice(0, visibleCatalogCount).map((cat) => {
                    const bp = getConnectorAuthBlueprint(cat);
                    return (
                      <Card key={cat.slug} className="p-4 flex flex-col justify-between gap-3">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold">{cat.name}</span>
                            <Badge variant="secondary" className="uppercase text-[10px]">
                              {cat.category}
                            </Badge>
                          </div>
                          <div className="text-[11px] font-mono text-muted-foreground">
                            {cat.slug} · {AUTH_SCHEME_LABELS[bp.defaultScheme]} · {getConnectorRuntimeTier(cat)}
                          </div>
                          <p className="text-xs text-muted-foreground pt-1">{cat.description}</p>
                        </div>
                        {isAdmin && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openAppConnect(cat)}
                          >
                            Connect ({AUTH_SCHEME_LABELS[bp.defaultScheme]})
                          </Button>
                        )}
                      </Card>
                    );
                  })}
                </div>
                {filteredCatalog.length > visibleCatalogCount && (
                  <div className="flex justify-center pt-2">
                    <Button
                      variant="outline"
                      onClick={() => setVisibleCatalogCount((c) => c + CATALOG_PAGE_SIZE)}
                    >
                      Show More ({Math.min(CATALOG_PAGE_SIZE, filteredCatalog.length - visibleCatalogCount)} more of{" "}
                      {(filteredCatalog.length - visibleCatalogCount).toLocaleString()} remaining)
                    </Button>
                  </div>
                )}
              </div>
            )
          )}

          {viewTab === "logs" && (
            <Card className="overflow-hidden">
              <div className="border-b border-border px-4 py-2.5 text-xs font-semibold">
                Recent Connector Sync &amp; Invoke Logs ({filteredLogs.length})
              </div>
              {filteredLogs.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  {logs.length === 0
                    ? "No connector sync or invocation activity recorded yet."
                    : "No connector logs match your filter."}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Direction</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Latency</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.slice(0, 20).map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-mono">{l.direction}</TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(l.status)} className="uppercase text-[10px]">
                            {l.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{l.message}</TableCell>
                        <TableCell className="font-mono tabular-nums">{l.latencyMs}ms</TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {new Date(l.createdAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
