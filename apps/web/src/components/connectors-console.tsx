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

export function isConnectorSupportedInRuntime(
  connector: { transport: string; endpointUrl: string },
  demoEnabled: boolean
): boolean {
  if (demoEnabled) return true;
  if (connector.transport === "remote_mcp" || connector.transport === "utcp_http") {
    return /^https:\/\//i.test(connector.endpointUrl.trim());
  }
  return (
    (connector.transport === "in_memory_mcp" || connector.transport === "kojo_protocol") &&
    /^(?:kojo|mcp):\/\/([a-z-]+)$/.test(connector.endpointUrl.trim())
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
  const [codeScript, setCodeScript] = useState(
    'const st = await kojo.callTool("get_machine_status", { machineId: input.machineId });\nreturn { machineId: input.machineId, status: st.status };'
  );
  const [invokeOutput, setInvokeOutput] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    kind: "http",
    endpointUrl: "",
    apiKey: ""
  });

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
        };
        const list = data.connectors ?? [];
        setConnectors(list);
        setCatalog(data.catalog ?? []);
        setLogs(data.logs ?? []);
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
          kind: form.kind,
          endpointUrl: form.endpointUrl.trim() || undefined,
          credentials: form.apiKey ? { apiKey: form.apiKey } : undefined
        })
      });
      if (res.ok) {
        setNotice(`Registered connector ${form.name}`);
        setForm({ name: "", kind: "http", endpointUrl: "", apiKey: "" });
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
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Kojo Connector Protocol
          </div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Plug className="h-5 w-5 text-primary" />
            <span>Connectors Hub</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Discover Kojo connectors, invoke governed tools, verify health, sync schemas, and inspect logs.
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
        </div>
      </div>

      {!demoEnabled && (
        <div className="rounded-md border border-border bg-muted/40 px-3.5 py-2 text-xs text-muted-foreground">
          Production mode: local <code className="font-mono">mcp://</code> / <code className="font-mono">kojo://</code> adapters, <code className="font-mono">remote_mcp</code> (Metorial, OpenConnectors, UTCP-MCP), and <code className="font-mono">utcp_http</code> (UTCP / OpenAPI over HTTPS) execute live tool discovery and invocations. Unimplemented raw HTTP/SCADA/ERP/webhook entries store configuration only and return HTTP 501.
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
                        className={`cursor-pointer p-4 space-y-2.5 transition-colors min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                          selected?.id === c.id
                            ? "border-primary ring-1 ring-primary"
                            : "hover:border-primary/50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-sm">{c.name}</div>
                            <div className="text-[11px] text-muted-foreground font-mono">
                              {c.slug} · {c.transport}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <Badge variant={statusBadgeVariant(c.status)} className="uppercase text-[10px]">
                              {c.status === "connected" && <CheckCircle2 className="h-3 w-3" />}
                              <span>{c.status}</span>
                            </Badge>
                            {!supported && (
                              <Badge variant="outline" className="text-[10px]">
                                External bridge unavailable
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="text-[11px] text-muted-foreground truncate">
                          Endpoint: <code className="font-mono">{c.endpointUrl || "in-memory"}</code>
                        </div>
                        {c.lastError && (
                          <div className="text-[11px] text-destructive line-clamp-2">
                            {c.lastError}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-1">
                          {(c.discoveredTools ?? []).slice(0, 4).map((t) => (
                            <Badge key={t.name} variant="secondary" className="font-mono text-[10px]">
                              {t.name}
                            </Badge>
                          ))}
                        </div>

                        {isAdmin && (
                          <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!supported}
                              title={!supported ? "External connector health checks require demo mode or an external bridge" : undefined}
                              onClick={async () => {
                                try {
                                  const res = await fetch(`/api/connectors/${c.id}/test`, {
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
                                      ? `Health test (${c.slug}): ${d.status ?? "ok"} — ${d.message ?? ""}`
                                      : d.detail ?? `Health test failed for ${c.slug}`
                                  );
                                  await load();
                                } catch {
                                  setNotice(`Health test request failed for ${c.slug}`);
                                }
                              }}
                            >
                              <Activity className="h-3 w-3" />
                              <span>Test</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!supported}
                              title={!supported ? "External connector sync requires demo mode or an external bridge" : undefined}
                              onClick={async () => {
                                try {
                                  const res = await fetch(`/api/connectors/${c.id}/sync`, {
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
                                      ? `Synced ${c.slug}: ${d.tools?.length ?? 0} tool(s)`
                                      : d.detail ?? `Sync failed for ${c.slug}`
                                  );
                                  await load();
                                } catch {
                                  setNotice(`Sync request failed for ${c.slug}`);
                                }
                              }}
                            >
                              <RefreshCw className="h-3 w-3" />
                              <span>Sync</span>
                            </Button>
                          </div>
                        )}
                      </Card>
                      );
                    })}
                  </div>
                )}
              </div>

              <aside className="space-y-4 min-w-0">
                {selected && !isAdmin && (
                  <Card className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">{selected.name}</div>
                      <Badge variant="outline" className="uppercase text-[10px]">
                        {selected.category}
                      </Badge>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div>
                        Transport: <code className="font-mono text-foreground">{selected.transport}</code>
                      </div>
                      <div className="truncate">
                        Endpoint: <code className="font-mono text-foreground">{selected.endpointUrl || "in-memory"}</code>
                      </div>
                      <div className="tabular-nums">
                        Last sync: {selected.lastSyncAt ? new Date(selected.lastSyncAt).toLocaleString() : "—"}
                      </div>
                    </div>
                    <div className="space-y-1.5 border-t border-border pt-2.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Discovered Tools ({selected.discoveredTools.length})
                      </div>
                      <div className="space-y-1.5 max-h-64 overflow-y-auto">
                        {selected.discoveredTools.map((t) => (
                          <div key={t.name} className="rounded border border-border bg-muted/40 p-2 text-xs">
                            <div className="font-mono font-semibold">{t.name}</div>
                            {t.description && (
                              <div className="text-[11px] text-muted-foreground mt-0.5">
                                {t.description}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </Card>
                )}

                {selected && isAdmin && (
                  <Card className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 text-sm font-semibold">
                        <Zap className="h-4 w-4 text-primary" />
                        <span>Tool Playground: {selected.slug}</span>
                      </div>
                      <div className="inline-flex rounded-md border border-border p-0.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setPlaygroundMode("tool")}
                          className={`px-2 py-0.5 rounded font-medium transition-colors ${
                            playgroundMode === "tool"
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Standard Tool
                        </button>
                        <button
                          type="button"
                          onClick={() => setPlaygroundMode("code")}
                          className={`px-2 py-0.5 rounded font-medium transition-colors ${
                            playgroundMode === "code"
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Kojo Code Mode
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
                          Isolated Code Mode Script (<code className="font-mono">kojo.callTool / kojo.connectors</code>)
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
                    {playgroundMode === "tool" && !isConnectorSupportedInRuntime(selected, demoEnabled) && (
                      <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-900 dark:text-amber-200">
                        External runtime unavailable in production mode. Use <code className="font-mono">remote_mcp</code>, <code className="font-mono">utcp_http</code> (HTTPS), or local <code className="font-mono">kojo://</code>/<code className="font-mono">mcp://</code> connectors.
                      </div>
                    )}
                    <Button
                      size="sm"
                      disabled={playgroundMode === "tool" && !isConnectorSupportedInRuntime(selected, demoEnabled)}
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
                      <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/50 p-2.5 text-[11px] font-mono">
                        {invokeOutput}
                      </pre>
                    )}
                  </Card>
                )}

                {isAdmin && (
                  <Card className="p-4">
                    <form onSubmit={handleRegister} className="space-y-3">
                      <div className="flex items-center gap-1.5 text-sm font-semibold">
                        <Plus className="h-4 w-4 text-primary" />
                        <span>Register Custom Connector</span>
                      </div>
                      {!demoEnabled && (
                        <p className="text-[11px] text-muted-foreground">
                          Non-demo mode stores external HTTP, webhook, SCADA, and ERP configuration only; use an{" "}
                          <code className="font-mono">mcp://</code> endpoint for local tool execution.
                        </p>
                      )}
                      <Input
                        required
                        placeholder="Connector Name (e.g. Plant SCADA Gateway)"
                        aria-label="Connector name"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Select
                          value={form.kind}
                          onChange={(e) => setForm({ ...form, kind: e.target.value })}
                          aria-label="Connector kind"
                        >
                          <option value="metorial">metorial (Remote MCP)</option>
                          <option value="open-connector">open-connector (Remote MCP)</option>
                          <option value="utcp-http">utcp-http (UTCP / OpenAPI)</option>
                          <option value="http">http</option>
                          <option value="webhook">webhook</option>
                          <option value="scada">scada</option>
                          <option value="erp">erp</option>
                        </Select>
                        <Input
                          type="password"
                          placeholder="API Key (encrypted)"
                          aria-label="Connector API key"
                          value={form.apiKey}
                          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                        />
                      </div>
                      <Input
                        placeholder="Endpoint URL"
                        aria-label="Connector endpoint URL"
                        value={form.endpointUrl}
                        onChange={(e) => setForm({ ...form, endpointUrl: e.target.value })}
                        className="font-mono"
                      />
                      <Button type="submit" className="w-full">
                        Register Connector
                      </Button>
                    </form>
                  </Card>
                )}
              </aside>
            </div>
          )}

          {viewTab === "catalog" && (
            filteredCatalog.length === 0 ? (
              <Card className="p-8 text-center text-xs text-muted-foreground">
                {catalog.length === 0
                  ? "No connector templates available."
                  : "No catalog templates match your search."}
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredCatalog.map((cat) => (
                  <Card key={cat.slug} className="p-4 flex flex-col justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{cat.name}</span>
                        <Badge variant="secondary" className="uppercase text-[10px]">
                          {cat.category}
                        </Badge>
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground">
                        {cat.slug} · {cat.transport}
                      </div>
                      <p className="text-xs text-muted-foreground pt-1">{cat.description}</p>
                    </div>
                    {isAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setForm({
                            name: cat.name,
                            kind:
                              cat.slug === "metorial" ||
                              cat.slug === "open-connector" ||
                              cat.slug === "utcp-http"
                                ? cat.slug
                                : cat.category === "scada" || cat.category === "erp"
                                  ? cat.category
                                  : "http",
                            endpointUrl: cat.credentialFields?.find((field) => field.key === "endpoint" || field.key === "endpointUrl")?.defaultValue ?? "",
                            apiKey: ""
                          });
                          setViewTab("connections");
                          setNotice(`Loaded ${cat.name} template into Register Custom Connector`);
                        }}
                      >
                        Use Template
                      </Button>
                    )}
                  </Card>
                ))}
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
