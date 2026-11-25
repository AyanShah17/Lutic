"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  X,
  Zap
} from "lucide-react";
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
  credentialFields?: Array<{ key: string; defaultValue?: string }>;
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

function statusBadgeVariant(status: string): "success" | "warning" | "destructive" | "outline" {
  if (status === "connected" || status === "success") return "success";
  if (status === "degraded" || status === "partial") return "warning";
  if (status === "error" || status === "failed") return "destructive";
  return "outline";
}

function formatTransportLabel(transport: string): string {
  switch (transport) {
    case "remote_mcp":
      return "Lutic Cloud";
    case "utcp_http":
      return "Lutic Direct API";
    case "in_memory_mcp":
      return "Lutic Native";
    case "lutic_protocol":
      return "Lutic Protocol";
    case "simulated":
      return "Managed Adapter";
    case "http":
      return "HTTPS";
    default:
      return transport;
  }
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
    ["servicenow", "sap-pm", "sap-mm", "sap-pp", "sap-qm", "jira", "linear", "slack"].some(
      (s) => slug === s || slug.startsWith(`${s}-`)
    )
  ) {
    return "Live Protocol";
  }
  return "Bridge Template";
}

export function isConnectorSupportedInRuntime(
  connector: { slug?: string; transport: string; endpointUrl: string },
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
  if (
    ["servicenow", "sap-pm", "sap-mm", "sap-pp", "sap-qm", "jira", "linear", "slack"].some(
      (s) => slug === s || slug.startsWith(`${s}-`)
    ) &&
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
  const [form, setForm] = useState({
    name: "",
    kind: "http",
    templateSlug: "",
    endpointUrl: "",
    apiKey: ""
  });
  const CATALOG_PAGE_SIZE = 60;
  const [visibleCatalogCount, setVisibleCatalogCount] = useState(CATALOG_PAGE_SIZE);
  const [registerOpen, setRegisterOpen] = useState(false);

  const isAdmin = user?.role === "admin";

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/connectors", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          connectors: ConnectorHubItem[];
          catalog: CatalogItem[];
          logs: SyncLogItem[];
          capabilities?: { codeMode?: boolean };
        };
        const list = data.connectors ?? [];
        setConnectors(list);
        setCatalog(data.catalog ?? []);
        setLogs(data.logs ?? []);
        setCodeModeEnabled(data.capabilities?.codeMode === true);
        setSelectedId((prev) => {
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
    if (user) void load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
        description="MCP, SCADA, CMMS, ERP, and webhook connector configurations require authentication."
      />
    );
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !isAdmin) return;
    try {
      const res = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          kind: form.templateSlug || form.kind,
          endpointUrl: form.endpointUrl.trim() || undefined,
          credentials: form.apiKey ? { apiKey: form.apiKey } : undefined
        })
      });
      if (res.ok) {
        setNotice(`Registered connector ${form.name}`);
        setForm({ name: "", kind: "http", templateSlug: "", endpointUrl: "", apiKey: "" });
        setRegisterOpen(false);
        await load();
      } else {
        const d = (await res.json().catch(() => ({}))) as { detail?: string };
        setNotice(d.detail ?? "Registration failed");
      }
    } catch {
      setNotice("Registration request failed");
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
            Discover Lutic connectors, invoke governed tools, verify health, and inspect sync logs.
          </p>
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
            <Button
              size="sm"
              onClick={() => setRegisterOpen(true)}
              className="shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Connector</span>
            </Button>
          )}
        </div>
      </div>

      {!demoEnabled && (
        <div className="rounded-md border border-border bg-muted/40 px-3.5 py-2 text-xs text-muted-foreground">
          Production mode: native Lutic adapters (<code className="font-mono">lutic://</code>), Lutic Cloud / Enterprise Bridge connectors, and Lutic Direct API specs over HTTPS execute live tool discovery and invocations. Unimplemented raw HTTP/SCADA/ERP/webhook entries store configuration only and return HTTP 501.
        </div>
      )}

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
                  <Card className="p-8 text-center text-xs text-muted-foreground">
                    {connectors.length === 0
                      ? (loadError ?? "No connectors configured for this tenant yet.")
                      : "No connectors match your search."}
                  </Card>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {filteredConnectors.map((c) => {
                      const supported = isConnectorSupportedInRuntime(c, demoEnabled);
                      return (
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
                              {formatTransportLabel(c.transport)} · {(c.discoveredTools ?? []).length} tool{(c.discoveredTools ?? []).length === 1 ? "" : "s"}
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
                      );
                    })}
                  </div>
                )}
              </div>

              <aside className="space-y-4 min-w-0">
                {selected && (
                  <Card className="p-4 space-y-4">
                    <div className="flex items-start justify-between gap-2 border-b border-border/70 pb-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{selected.name}</div>
                        <div className="text-[11px] font-mono text-muted-foreground truncate mt-0.5">
                          {formatTransportLabel(selected.transport)} · {selected.endpointUrl || "in-memory"}
                        </div>
                        {!isConnectorSupportedInRuntime(selected, demoEnabled) && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                            External bridge unavailable in current mode
                          </div>
                        )}
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!isConnectorSupportedInRuntime(selected, demoEnabled)}
                            title={
                              !isConnectorSupportedInRuntime(selected, demoEnabled)
                                ? "External connector health checks require demo mode or an external bridge"
                                : undefined
                            }
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
                                await load();
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
                            title={
                              !isConnectorSupportedInRuntime(selected, demoEnabled)
                                ? "External connector sync requires demo mode or an external bridge"
                                : undefined
                            }
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
                                await load();
                              } catch {
                                setNotice(`Sync request failed for ${selected.slug}`);
                              }
                            }}
                          >
                            <RefreshCw className="h-3 w-3" />
                            <span>Sync</span>
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
                              title={codeModeEnabled ? undefined : "Code Mode is available only in trusted development and tests"}
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
                              await load();
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

          <Dialog
            open={registerOpen}
            onOpenChange={setRegisterOpen}
            ariaLabel="Register custom connector"
            className="max-w-md p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">Add Connector</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Register a plant protocol bridge, ERP adapter, or HTTPS endpoint.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setRegisterOpen(false)}
                aria-label="Close connector registration dialog"
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleRegister} className="space-y-3">
              {!demoEnabled && (
                <p className="text-[11px] text-muted-foreground">
                  Non-demo mode stores external HTTP, webhook, SCADA, and ERP configuration only; use a native{" "}
                  <code className="font-mono">lutic://</code> or Lutic Cloud HTTPS endpoint for live execution.
                </p>
              )}
              <div className="space-y-1">
                <Label htmlFor="reg-conn-name">Connector Name</Label>
                <Input
                  id="reg-conn-name"
                  required
                  placeholder="e.g. Plant SCADA Gateway"
                  aria-label="Connector name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reg-conn-kind">Protocol / System Type</Label>
                <Select
                  id="reg-conn-kind"
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value })}
                  aria-label="Connector kind"
                >
                  <option value="lutic-cloud">Lutic Cloud Connectors</option>
                  <option value="lutic-bridge">Lutic Enterprise Bridge</option>
                  <option value="lutic-api">Lutic Direct API (OpenAPI)</option>
                  <option value="sap-pm">SAP S/4HANA PM</option>
                  <option value="sap-mm">SAP S/4HANA MM</option>
                  <option value="sap-pp">SAP S/4HANA PP</option>
                  <option value="sap-qm">SAP S/4HANA QM</option>
                  <option value="aws-iot">AWS IoT SiteWise / Core</option>
                  <option value="aws-s3">AWS S3 Data Lake</option>
                  <option value="aws-cloudwatch">AWS CloudWatch / Timestream</option>
                  <option value="servicenow">ServiceNow ITSM</option>
                  <option value="mqtt-broker">MQTT Broker (Sparkplug B)</option>
                  <option value="opc-ua">OPC-UA Server</option>
                  <option value="modbus-tcp">Modbus TCP / RTU</option>
                  <option value="http">HTTP / REST</option>
                  <option value="webhook">Webhook</option>
                  <option value="scada">SCADA</option>
                  <option value="erp">ERP</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="reg-conn-url">Endpoint URL</Label>
                <Input
                  id="reg-conn-url"
                  placeholder="https://... or mqtt://..."
                  aria-label="Connector endpoint URL"
                  value={form.endpointUrl}
                  onChange={(e) => setForm({ ...form, endpointUrl: e.target.value })}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reg-conn-key">API Key (encrypted)</Label>
                <Input
                  id="reg-conn-key"
                  type="password"
                  placeholder="Optional secret token"
                  aria-label="Connector API key"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setRegisterOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Register Connector
                </Button>
              </div>
            </form>
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
                {filteredCatalog.slice(0, visibleCatalogCount).map((cat) => (
                  <Card key={cat.slug} className="p-4 flex flex-col justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{cat.name}</span>
                        <Badge variant="secondary" className="uppercase text-[10px]">
                          {cat.category}
                        </Badge>
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground">
                        {cat.slug} · {formatTransportLabel(cat.transport)} · {getConnectorRuntimeTier(cat)}
                      </div>
                      <p className="text-xs text-muted-foreground pt-1">{cat.description}</p>
                    </div>
                    {isAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const directKindSlugs = new Set([
                            "lutic-cloud",
                            "lutic-bridge",
                            "lutic-api",
                            "sap-pm",
                            "sap-mm",
                            "sap-pp",
                            "sap-qm",
                            "aws-iot",
                            "aws-s3",
                            "aws-cloudwatch",
                            "servicenow",
                            "mqtt-broker",
                            "opc-ua",
                            "modbus-tcp"
                          ]);
                          setForm({
                            name: cat.name,
                            kind: directKindSlugs.has(cat.slug)
                              ? cat.slug
                              : cat.category === "scada" || cat.category === "erp"
                                ? cat.category
                                : "http",
                            templateSlug: cat.slug,
                            endpointUrl: cat.credentialFields?.find((field) => field.key === "endpoint" || field.key === "endpointUrl")?.defaultValue ?? "",
                            apiKey: ""
                          });
                          setViewTab("connections");
                          setRegisterOpen(true);
                          setNotice(`Loaded ${cat.name} template into Add Connector`);
                        }}
                      >
                        Use Template
                      </Button>
                    )}
                  </Card>
                ))}
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
