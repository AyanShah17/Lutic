"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BookOpen,
  Cpu,
  Download,
  FileText,
  KeyRound,
  Lock,
  Plug,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Sliders,
  Upload,
  Users,
  X
} from "lucide-react";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "@lutic/core/rbac";
import { ActivateLicensePanel } from "./activate-license-panel";
import { AssetCreateForm } from "./admin-asset-create-form";
import { useAppContext } from "./providers";
import { Badge } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
import { Card } from "./ui/card";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Textarea } from "./ui/textarea";

type TabId =
  | "users"
  | "rbac"
  | "license"
  | "connectors"
  | "toolkits"
  | "knowledge"
  | "audit"
  | "usage"
  | "assets"
  | "diagnostics";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  tokenVersion?: number;
  passwordUpdatedAt?: string | null;
  plantIds: string[];
}

interface IngestionTokenRow {
  id: string;
  plantId: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  active: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface DiagnosticsSnapshot {
  checkedAt: string;
  database: {
    status: string;
    latencyMs: number;
    pool: { totalCount?: number; idleCount?: number; waitingCount?: number; max?: number } | null;
  };
  runtime: {
    startedAt: string | null;
    lastTickAt: string | null;
    lastTickDurationMs: number | null;
    lastTickError: string | null;
    tickCount: number;
    lastTickSummary: Record<string, number> | null;
  };
  scanner: {
    status: "ready" | "unconfigured" | "unavailable";
    version?: string;
    latencyMs?: number;
    detail?: string;
  };
  license: {
    enforced: boolean;
    status: string;
    active: boolean;
    plan: string;
  };
  migrations: {
    currentVersion: number;
    applied: Array<{ version: number; name: string; appliedAt: string }>;
  };
  retention: { configuredDays: number };
  telemetry: {
    totalMachines: number;
    machinesWithTelemetry: number;
    missingTelemetry: number;
    staleMachines: number;
    staleThresholdMinutes: number;
    latestTelemetryAt: string | null;
  };
  queues: {
    ready: number;
    inFlight: number;
    deadLetter: number;
  };
}

interface PlantRow {
  id: string;
  name: string;
  code: string;
}

interface ConnectorRow {
  id: string;
  kind: string;
  name: string;
  status: string;
  lastSyncAt: string;
  lastError: string | null;
}

interface ConnectorSchemaItem {
  kind: string;
  name: string;
  fields: Array<{ key: string; type: string; defaultValue: unknown }>;
  tools: string[];
}

interface ToolkitItem {
  id: string;
  name: string;
  description: string;
  tools: Array<{
    id: string;
    toolName: string;
    enabled: boolean;
    meta: { requiredPermission: string; access: string; riskLevel: string } | null;
  }>;
}

interface RoleToolkitRow {
  id: string;
  role: string;
  toolkitId: string;
  enabled: boolean;
}

interface DocRow {
  id: string;
  title: string;
  type: string;
  machineTypes: string[];
  revision: string;
  status: "current" | "superseded";
  effectiveDate: string;
  source: string;
  ingestionStatus: string;
}

interface AuditEntry {
  id: string;
  userId: string;
  role: string;
  action: string;
  toolName: string;
  args: Record<string, unknown>;
  resultHash: string;
  status: string;
  reason: string;
  latencyMs: number;
  createdAt: string;
}

interface AssetRow {
  id: string;
  name: string;
  type: string;
  plantId: string;
  parentId: string | null;
  machineType: string;
  manufacturer: string;
  model: string;
  criticality: "A" | "B" | "C";
  liveStatus: string | null;
}

const ADMIN_GROUPS: Array<{
  group: string;
  items: Array<{ id: TabId; label: string; Icon: React.ComponentType<{ className?: string }> }>;
}> = [
  {
    group: "Access & Governance",
    items: [
      { id: "users", label: "Users & Roles", Icon: Users },
      { id: "rbac", label: "IAM Matrix", Icon: Lock },
      { id: "license", label: "License", Icon: KeyRound }
    ]
  },
  {
    group: "Integrations & AI",
    items: [
      { id: "connectors", label: "Connectors", Icon: Plug },
      { id: "toolkits", label: "Toolkits", Icon: Sliders },
      { id: "knowledge", label: "Knowledge", Icon: BookOpen }
    ]
  },
  {
    group: "Telemetry & Audit",
    items: [
      { id: "assets", label: "Assets & QR", Icon: Cpu },
      { id: "audit", label: "Audit Log", Icon: FileText },
      { id: "usage", label: "Usage & Cost", Icon: Activity },
      { id: "diagnostics", label: "Diagnostics & Retention", Icon: Shield }
    ]
  }
];

async function readAdminError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { detail?: string; error?: string } | null;
  return data?.detail || data?.error || fallback;
}

export function AdminConsole() {
  const { user, t, demoEnabled } = useAppContext();
  const [tab, setTab] = useState<TabId>("toolkits");
  const [loadingTab, setLoadingTab] = useState(false);
  const [tabError, setTabError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const [usersData, setUsersData] = useState<{ users: UserRow[]; plants: PlantRow[] }>({
    users: [],
    plants: []
  });
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resettingPw, setResettingPw] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    name: "",
    password: "",
    role: "engineer",
    plantIds: [] as string[]
  });

  const [connectorsData, setConnectorsData] = useState<{
    connectors: ConnectorRow[];
    schemas: ConnectorSchemaItem[];
  }>({ connectors: [], schemas: [] });
  const [selectedConnKind, setSelectedConnKind] = useState("cmms");
  const [credDraft, setCredDraft] = useState<Record<string, unknown>>({});

  const [toolkitsData, setToolkitsData] = useState<{
    toolkits: ToolkitItem[];
    roleToolkits: RoleToolkitRow[];
  }>({ toolkits: [], roleToolkits: [] });

  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docForm, setDocForm] = useState({
    title: "",
    type: "manual",
    revision: "Rev 1.0",
    machineTypes: "filler",
    rawContent: "",
    supersedePrevious: true
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditFilter, setAuditFilter] = useState({
    userId: "",
    toolName: "",
    status: ""
  });
  const [selectedAudit, setSelectedAudit] = useState<AuditEntry | null>(null);

  const [usageData, setUsageData] = useState<{
    summary: {
      totalCalls: number;
      totalTokens: number;
      totalCostUsd: number;
      helpfulnessRate: number;
      fixedCount: number;
      totalFeedback: number;
    };
    byModel: Array<{ model: string; calls: number; tokens: number; costUsd: number }>;
    byUser: Array<{ userId: string; role: string; calls: number; tokens: number; costUsd: number }>;
    wrongAnswers: Array<{
      id: string;
      userId: string;
      outcome: string;
      comment: string;
      answerExcerpt: string;
    }>;
  } | null>(null);

  const [assetsData, setAssetsData] = useState<AssetRow[]>([]);
  const [assetPlants, setAssetPlants] = useState<PlantRow[]>([]);
  const [editingAsset, setEditingAsset] = useState<AssetRow | null>(null);
  const [qrModal, setQrModal] = useState<{
    machineId: string;
    url: string;
    svg: string;
  } | null>(null);
  const [ingestionTokensData, setIngestionTokensData] = useState<IngestionTokenRow[]>([]);
  const [tokenForm, setTokenForm] = useState({ plantId: "", name: "", expiresInDays: "90" });
  const [revealedToken, setRevealedToken] = useState<{ token: string; name: string; plantId: string } | null>(null);
  const [diagnosticsData, setDiagnosticsData] = useState<DiagnosticsSnapshot | null>(null);
  const [retentionDaysInput, setRetentionDaysInput] = useState("90");
  const [runningRetention, setRunningRetention] = useState(false);
  const [retentionResult, setRetentionResult] = useState<Record<string, unknown> | null>(null);

  const loadTab = async (activeTab: TabId) => {
    setLoadingTab(true);
    setTabError(null);
    try {
      if (activeTab === "users") {
        const res = await fetch("/api/admin/users");
        if (res.ok) setUsersData(await res.json());
        else setTabError(await readAdminError(res, "Failed to load users."));
      } else if (activeTab === "connectors") {
        const res = await fetch("/api/admin/connectors");
        if (res.ok) {
          const d = (await res.json()) as {
            connectors: ConnectorRow[];
            schemas: ConnectorSchemaItem[];
          };
          setConnectorsData(d);
          const schema = d.schemas.find((s) => s.kind === selectedConnKind) ?? d.schemas[0];
          if (schema) {
            const defaults: Record<string, unknown> = {};
            for (const f of schema.fields) defaults[f.key] = f.defaultValue;
            setCredDraft(defaults);
          }
        } else {
          setTabError(await readAdminError(res, "Failed to load connectors."));
        }
      } else if (activeTab === "toolkits") {
        const res = await fetch("/api/admin/toolkits");
        if (res.ok) setToolkitsData(await res.json());
        else setTabError(await readAdminError(res, "Failed to load toolkits."));
      } else if (activeTab === "knowledge") {
        const res = await fetch("/api/admin/knowledge");
        if (res.ok) {
          const d = (await res.json()) as { documents: DocRow[] };
          setDocs(d.documents);
        } else {
          setTabError(await readAdminError(res, "Failed to load knowledge documents."));
        }
      } else if (activeTab === "audit") {
        const params = new URLSearchParams();
        if (auditFilter.userId) params.set("userId", auditFilter.userId);
        if (auditFilter.toolName) params.set("toolName", auditFilter.toolName);
        if (auditFilter.status) params.set("status", auditFilter.status);
        const res = await fetch(`/api/admin/audit?${params.toString()}`);
        if (res.ok) {
          const d = (await res.json()) as { entries: AuditEntry[] };
          setAuditEntries(d.entries);
        } else {
          setTabError(await readAdminError(res, "Failed to load audit entries."));
        }
      } else if (activeTab === "usage") {
        const res = await fetch("/api/admin/usage");
        if (res.ok) setUsageData(await res.json());
        else setTabError(await readAdminError(res, "Failed to load usage metrics."));
      } else if (activeTab === "assets") {
        const [assetsRes, tokensRes] = await Promise.all([
          fetch("/api/admin/assets"),
          fetch("/api/admin/ingestion-tokens")
        ]);
        const errors: string[] = [];
        if (assetsRes.ok) {
          const d = (await assetsRes.json()) as { assets: AssetRow[]; plants: PlantRow[] };
          setAssetsData(d.assets);
          setAssetPlants(d.plants);
          const firstPlantId = d.plants[0]?.id;
          if (!tokenForm.plantId && firstPlantId) {
            setTokenForm((prev) => ({ ...prev, plantId: firstPlantId }));
          }
        } else {
          errors.push(await readAdminError(assetsRes, "Failed to load assets."));
        }
        if (tokensRes.ok) {
          const td = (await tokensRes.json()) as { tokens: IngestionTokenRow[] };
          setIngestionTokensData(td.tokens ?? []);
        } else {
          errors.push(await readAdminError(tokensRes, "Failed to load ingestion tokens."));
        }
        if (errors.length > 0) setTabError(errors[0] ?? "Failed to load assets section.");
      } else if (activeTab === "diagnostics") {
        const res = await fetch("/api/admin/diagnostics", { cache: "no-store" });
        if (res.ok) {
          const d = (await res.json()) as DiagnosticsSnapshot;
          setDiagnosticsData(d);
          setRetentionDaysInput(String(d.retention.configuredDays ?? 90));
        } else {
          setTabError(await readAdminError(res, "Failed to load system diagnostics."));
        }
      }
    } catch {
      setTabError(`Unable to load ${activeTab} section.`);
    } finally {
      setLoadingTab(false);
    }
  };

  useEffect(() => {
    if (user?.role === "admin") {
      loadTab(tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, user?.userId, user?.role]);

  const q = search.trim().toLowerCase();

  const filteredUsers = useMemo(() => {
    if (!q) return usersData.users;
    return usersData.users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
    );
  }, [usersData.users, q]);

  const filteredDocs = useMemo(() => {
    if (!q) return docs;
    return docs.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.revision.toLowerCase().includes(q) ||
        d.type.toLowerCase().includes(q)
    );
  }, [docs, q]);

  const filteredAssets = useMemo(() => {
    const assets = assetsData.filter((a) => a.type === "machine" || a.type === "line");
    if (!q) return assets;
    return assets.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.machineType.toLowerCase().includes(q)
    );
  }, [assetsData, q]);

  const filteredConnectors = useMemo(() => {
    if (!q) return connectorsData.connectors;
    return connectorsData.connectors.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.kind.toLowerCase().includes(q) ||
        c.status.toLowerCase().includes(q)
    );
  }, [connectorsData.connectors, q]);

  const filteredToolkits = useMemo(() => {
    if (!q) return toolkitsData.toolkits;
    return toolkitsData.toolkits.filter(
      (tk) =>
        tk.name.toLowerCase().includes(q) ||
        tk.description.toLowerCase().includes(q) ||
        tk.tools.some((tool) => tool.toolName.toLowerCase().includes(q))
    );
  }, [toolkitsData.toolkits, q]);

  const filteredAudit = useMemo(() => {
    if (!q) return auditEntries;
    return auditEntries.filter(
      (e) =>
        e.userId.toLowerCase().includes(q) ||
        e.role.toLowerCase().includes(q) ||
        e.toolName.toLowerCase().includes(q) ||
        e.status.toLowerCase().includes(q) ||
        e.reason.toLowerCase().includes(q)
    );
  }, [auditEntries, q]);

  if (!user || user.role !== "admin") {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center space-y-3">
        <ShieldAlert className="h-10 w-10 text-destructive mx-auto" />
        <h1 className="text-xl font-bold">403 — Admin Access Required</h1>
        <p className="text-sm text-muted-foreground">
          Only users with the <strong>admin</strong> role can open the Admin Console.
        </p>
      </div>
    );
  }

  const activeSchema = connectorsData.schemas.find(
    (s) => s.kind === selectedConnKind
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Platform Governance
          </div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span>{t("admin.title")}</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Changes to toolkits, connectors, knowledge revisions, and user scoping take effect immediately.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-auto">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter current section..."
              aria-label="Filter current admin section"
              className="pl-8 w-full sm:w-52"
            />
          </div>
          {notice && (
            <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium flex items-center gap-2">
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label="Dismiss admin notice"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Categorized Admin Sub-Navigation Sidebar */}
        <aside className="w-full lg:w-56 shrink-0 space-y-4">
          {ADMIN_GROUPS.map((grp) => (
            <div key={grp.group} className="space-y-1">
              <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {grp.group}
              </div>
              <div className="flex flex-row lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
                {grp.items.map(({ id, label, Icon }) => {
                  const active = tab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors min-h-[36px] ${
                        active
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "border border-border bg-card text-foreground hover:bg-muted/60"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </aside>

        {/* Active Admin Panel */}
        <div className="flex-1 min-w-0 w-full space-y-5">
          {loadingTab && tab !== "rbac" && tab !== "license" && (
            <div className="h-44 rounded-lg border border-border bg-muted animate-pulse" />
          )}

          {!loadingTab && tabError && tab !== "rbac" && tab !== "license" && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive flex items-center justify-between gap-3"
            >
              <span>{tabError}</span>
              <Button variant="outline" size="sm" onClick={() => loadTab(tab)}>
                Retry
              </Button>
            </div>
          )}

          {!loadingTab && tab === "users" && (
            <div className="grid gap-6 xl:grid-cols-3">
              <Card className="p-4 h-fit">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                    const res = await fetch("/api/admin/users", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(inviteForm)
                    });
                    if (res.ok) {
                      setNotice(`Created ${inviteForm.email}. Share the password with them securely.`);
                      setInviteForm({ email: "", name: "", password: "", role: "engineer", plantIds: [] });
                      loadTab("users");
                    } else {
                      setNotice(await readAdminError(res, "Could not create user."));
                    }
                    } catch {
                      setNotice("Unable to connect. Please try again.");
                    }
                  }}
                  className="space-y-3"
                >
                  <h2 className="text-sm font-semibold">Create User</h2>
                  <Input
                    type="email"
                    required
                    placeholder="Work email"
                    aria-label="Work email"
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  />
                  <Input
                    required
                    placeholder="Full name"
                    aria-label="Full name"
                    value={inviteForm.name}
                    onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                  />
                  <Select
                    aria-label="New user role"
                    value={inviteForm.role}
                    onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                    className="w-full"
                  >
                    <option value="engineer">engineer</option>
                    <option value="analyst">analyst</option>
                    <option value="manager">manager</option>
                    <option value="admin">admin</option>
                  </Select>
                  <Input
                    type="password"
                    aria-label="New user password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={1024}
                    placeholder="Unique password (12+ characters)"
                    value={inviteForm.password}
                    onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
                  />
                  <div className="space-y-1 text-xs">
                    <div className="font-semibold">Plant Scope</div>
                    {usersData.plants.map((p) => (
                      <label key={p.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={inviteForm.plantIds.includes(p.id)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...inviteForm.plantIds, p.id]
                              : inviteForm.plantIds.filter((id) => id !== p.id);
                            setInviteForm({ ...inviteForm, plantIds: next });
                          }}
                        />
                        <span>{p.name}</span>
                      </label>
                    ))}
                  </div>
                  <Button type="submit" className="w-full" disabled={!inviteForm.plantIds.length}>
                    Create User
                  </Button>
                </form>
              </Card>

              <Card className="xl:col-span-2 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Authorized Plants</TableHead>
                      <TableHead>Security &amp; Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-8 text-center text-xs text-muted-foreground">
                          {usersData.users.length === 0
                            ? "No users found for this tenant."
                            : "No users match your filter."}
                        </TableCell>
                      </TableRow>
                    ) : (
                    filteredUsers.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{u.name}</span>
                            <Badge variant={u.active ? "success" : "destructive"} className="text-[10px] uppercase">
                              {u.active ? "Active" : "Disabled"}
                            </Badge>
                          </div>
                          <div className="text-muted-foreground">{u.email}</div>
                          {u.passwordUpdatedAt && (
                            <div className="text-[10px] text-muted-foreground">
                              Password updated {new Date(u.passwordUpdatedAt).toISOString().slice(0, 10)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={u.role}
                            aria-label={`Role for ${u.email}`}
                            onChange={async (e) => {
                              try {
                                const res = await fetch("/api/admin/users", {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ userId: u.id, role: e.target.value })
                                });
                                if (!res.ok) {
                                  setNotice(await readAdminError(res, `Failed to update role for ${u.email}`));
                                  return;
                                }
                                setNotice(`Updated role for ${u.email}`);
                                loadTab("users");
                              } catch {
                                setNotice(`Failed to update role for ${u.email}`);
                              }
                            }}
                            className="h-8"
                          >
                            {["engineer", "analyst", "manager", "admin"].map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </Select>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {usersData.plants.map((p) => {
                              const has = u.plantIds.includes(p.id);
                              return (
                                <label key={p.id} className="inline-flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={has}
                                    onChange={async (e) => {
                                      const next = e.target.checked
                                        ? [...u.plantIds, p.id]
                                        : u.plantIds.filter((id) => id !== p.id);
                                      if (next.length === 0) return;
                                      try {
                                        const res = await fetch("/api/admin/users", {
                                          method: "PATCH",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ userId: u.id, plantIds: next })
                                        });
                                        if (!res.ok) {
                                          setNotice(await readAdminError(res, `Failed to update plants for ${u.email}`));
                                          return;
                                        }
                                        setNotice(`Updated plants for ${u.email}`);
                                        loadTab("users");
                                      } catch {
                                        setNotice(`Failed to update plants for ${u.email}`);
                                      }
                                    }}
                                  />
                                  <span>{p.code}</span>
                                </label>
                              );
                            })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setResetTarget(u);
                                setResetPassword("");
                                setResetError(null);
                              }}
                            >
                              Reset Password
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                try {
                                  const res = await fetch("/api/admin/users", {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ userId: u.id, revokeSessions: true })
                                  });
                                  if (!res.ok) {
                                    setNotice(await readAdminError(res, `Failed to revoke sessions for ${u.email}`));
                                    return;
                                  }
                                  setNotice(`Revoked all active sessions for ${u.email}`);
                                  loadTab("users");
                                } catch {
                                  setNotice(`Failed to revoke sessions for ${u.email}`);
                                }
                              }}
                            >
                              Revoke Sessions
                            </Button>
                            <Button
                              variant={u.active ? "outline" : "default"}
                              size="sm"
                              onClick={async () => {
                                try {
                                  const res = await fetch("/api/admin/users", {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ userId: u.id, active: !u.active })
                                  });
                                  if (!res.ok) {
                                    setNotice(
                                      await readAdminError(res, `Failed to update account status for ${u.email}`)
                                    );
                                    return;
                                  }
                                  setNotice(
                                    `${u.active ? "Disabled" : "Reactivated"} user ${u.email}`
                                  );
                                  loadTab("users");
                                } catch {
                                  setNotice(`Failed to update account status for ${u.email}`);
                                }
                              }}
                            >
                              {u.active ? "Disable" : "Activate"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {tab === "rbac" && (
            <Card className="p-4 space-y-3 overflow-hidden">
              <div>
                <h2 className="text-sm font-semibold">
                  Unified IAM Role → Permission Matrix ({PERMISSIONS.length} Permissions)
                </h2>
                <p className="text-xs text-muted-foreground">
                  Enforced server-side by <code className="font-mono">authorize()</code> across APIs, MCP connectors, and UI visibility.
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Permission</TableHead>
                    {ROLES.map((r) => (
                      <TableHead key={r} className="capitalize">
                        {r}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PERMISSIONS.filter((perm) => (q ? perm.toLowerCase().includes(q) : true)).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={ROLES.length + 1} className="py-8 text-center text-xs text-muted-foreground">
                        No permissions match your filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                  PERMISSIONS.filter((perm) =>
                    q ? perm.toLowerCase().includes(q) : true
                  ).map((perm) => (
                    <TableRow key={perm}>
                      <TableCell className="font-mono">{perm}</TableCell>
                      {ROLES.map((r) => (
                        <TableCell key={r}>
                          {ROLE_PERMISSIONS[r].has(perm) ? (
                            <Badge variant="success" className="text-[10px]">
                              ALLOW
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                  )}
                </TableBody>
              </Table>
            </Card>
          )}

          {tab === "license" && <ActivateLicensePanel />}

          {!loadingTab && tab === "connectors" && (
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="space-y-3">
                {filteredConnectors.length === 0 ? (
                  <Card className="p-6 text-center text-xs text-muted-foreground">
                    {connectorsData.connectors.length === 0
                      ? "No connectors configured for this tenant yet."
                      : "No connectors match your filter."}
                  </Card>
                ) : (
                filteredConnectors.map((c) => (
                  <Card
                    key={c.id}
                    className="p-4 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-semibold text-sm">{c.name}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        Kind: <code className="font-mono">{c.kind}</code> · Last sync:{" "}
                        {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString() : "—"}
                      </div>
                      {c.lastError && (
                        <div className="text-xs text-red-600 mt-1">{c.lastError}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          c.status === "connected" || c.status === "healthy"
                            ? "success"
                            : c.status === "degraded"
                              ? "warning"
                              : c.status === "error"
                                ? "destructive"
                                : "outline"
                        }
                        className="uppercase text-[10px]"
                      >
                        {c.status}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedConnKind(c.kind);
                          const schema = connectorsData.schemas.find((s) => s.kind === c.kind);
                          if (schema) {
                            const d: Record<string, unknown> = {};
                            for (const f of schema.fields) d[f.key] = f.defaultValue;
                            setCredDraft(d);
                          }
                        }}
                      >
                        Configure
                      </Button>
                    </div>
                  </Card>
                ))
                )}
              </div>

              {activeSchema && (
                <Card className="p-5 space-y-4 h-fit">
                  <div>
                    <h2 className="text-sm font-semibold">
                      Configure {activeSchema.name} ({activeSchema.kind})
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {activeSchema.fields.length === 0
                        ? "Production mode uses in-process local MCP tools; external credential fields are hidden."
                        : "Encrypted at rest with AES-256-GCM; credentials are never returned to clients."}
                    </p>
                  </div>
                  <div className="space-y-3">
                    {activeSchema.fields.map((f) => {
                      const fieldId = `conn-${activeSchema.kind}-${f.key}`;
                      return (
                      <div key={f.key} className="space-y-1">
                        <label htmlFor={fieldId} className="text-xs font-medium">{f.key}</label>
                        {f.type === "boolean" ? (
                          <input
                            id={fieldId}
                            type="checkbox"
                            checked={Boolean(credDraft[f.key])}
                            onChange={(e) =>
                              setCredDraft({ ...credDraft, [f.key]: e.target.checked })
                            }
                            className="ml-2"
                          />
                        ) : (
                          <Input
                            id={fieldId}
                            type={
                              f.type === "password"
                                ? "password"
                                : f.type === "number"
                                  ? "number"
                                  : "text"
                            }
                            value={String(credDraft[f.key] ?? "")}
                            onChange={(e) =>
                              setCredDraft({ ...credDraft, [f.key]: e.target.value })
                            }
                          />
                        )}
                      </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={!demoEnabled && activeSchema.fields.length > 0}
                      title={
                        !demoEnabled && activeSchema.fields.length > 0
                          ? "External system connectivity checks are unavailable outside demo mode"
                          : undefined
                      }
                      onClick={async () => {
                        try {
                          const res = await fetch("/api/admin/connectors", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              kind: activeSchema.kind,
                              name: activeSchema.name,
                              credentials: credDraft,
                              action: "test"
                            })
                          });
                          if (!res.ok) {
                            setNotice(await readAdminError(res, `Test failed for ${activeSchema.kind}`));
                            return;
                          }
                          const d = (await res.json()) as {
                            health: { latencyMs: number; message: string };
                          };
                          setNotice(`Test passed (${d.health.latencyMs}ms): ${d.health.message}`);
                          loadTab("connectors");
                        } catch {
                          setNotice(`Test request failed for ${activeSchema.kind}`);
                        }
                      }}
                    >
                      {activeSchema.fields.length === 0 ? "Verify Local MCP" : "Test Connection"}
                    </Button>
                    <Button
                      onClick={async () => {
                        try {
                          const res = await fetch("/api/admin/connectors", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              kind: activeSchema.kind,
                              name: activeSchema.name,
                              credentials: credDraft,
                              action: "save"
                            })
                          });
                          if (res.ok) {
                            setNotice(
                              activeSchema.fields.length === 0
                                ? `Saved local MCP configuration for ${activeSchema.kind}`
                                : `Encrypted credentials saved for ${activeSchema.kind}`
                            );
                            loadTab("connectors");
                          } else {
                            setNotice(await readAdminError(res, `Failed to save ${activeSchema.kind}`));
                          }
                        } catch {
                          setNotice(`Save request failed for ${activeSchema.kind}`);
                        }
                      }}
                    >
                      {activeSchema.fields.length === 0 ? "Save Local MCP Config" : "Save Credentials"}
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          )}

          {!loadingTab && tab === "toolkits" && (
            <div className="space-y-5">
              <Card className="p-4 space-y-3 overflow-hidden">
                <h2 className="text-sm font-semibold">
                  Role → Toolkit Matrix (Live Enforcement)
                </h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Toolkit</TableHead>
                      {(["engineer", "analyst", "manager", "admin"] as const).map((r) => (
                        <TableHead key={r} className="capitalize">
                          {r}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredToolkits.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                          {toolkitsData.toolkits.length === 0
                            ? "No toolkits configured."
                            : "No toolkits match your filter."}
                        </TableCell>
                      </TableRow>
                    ) : (
                    filteredToolkits.map((tk) => (
                      <TableRow key={tk.id}>
                        <TableCell>
                          <div className="font-semibold capitalize">{tk.name}</div>
                          <div className="text-muted-foreground">{tk.description}</div>
                        </TableCell>
                        {(["engineer", "analyst", "manager", "admin"] as const).map((r) => {
                          const entry = toolkitsData.roleToolkits.find(
                            (rt) => rt.role === r && rt.toolkitId === tk.id
                          );
                          const checked = Boolean(entry?.enabled);
                          return (
                            <TableCell key={r}>
                              <input
                                type="checkbox"
                                aria-label={`${r} ${tk.name} toolkit`}
                                checked={checked}
                                onChange={async (e) => {
                                  try {
                                    const res = await fetch("/api/admin/toolkits", {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        mode: "role_toolkit",
                                        role: r,
                                        toolkitId: tk.id,
                                        enabled: e.target.checked
                                      })
                                    });
                                    if (!res.ok) {
                                      setNotice(await readAdminError(res, `Failed to update ${r} → ${tk.name}`));
                                      return;
                                    }
                                    setNotice(`Updated ${r} → ${tk.name} (${e.target.checked ? "ON" : "OFF"})`);
                                    loadTab("toolkits");
                                  } catch {
                                    setNotice(`Failed to update ${r} → ${tk.name}`);
                                  }
                                }}
                              />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))
                    )}
                  </TableBody>
                </Table>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                {filteredToolkits.map((tk) => (
                  <Card key={tk.id} className="p-4 space-y-2">
                    <div className="font-semibold text-sm capitalize">
                      {tk.name} Toolkit Tools
                    </div>
                    {tk.tools.map((tool) => (
                      <div
                        key={tool.id}
                        className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-xs"
                      >
                        <div>
                          <code className="font-semibold font-mono">{tool.toolName}</code>
                          {tool.meta && (
                            <span className="ml-2 text-muted-foreground">
                              [{tool.meta.requiredPermission} · {tool.meta.access}]
                            </span>
                          )}
                        </div>
                        <input
                          type="checkbox"
                          aria-label={`Toggle tool ${tool.toolName}`}
                          checked={tool.enabled}
                          onChange={async (e) => {
                            try {
                              const res = await fetch("/api/admin/toolkits", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  mode: "toolkit_tool",
                                  toolkitId: tk.id,
                                  toolName: tool.toolName,
                                  enabled: e.target.checked
                                })
                              });
                              if (!res.ok) {
                                setNotice(await readAdminError(res, `Failed to update tool ${tool.toolName}`));
                                return;
                              }
                              setNotice(`Tool ${tool.toolName} ${e.target.checked ? "enabled" : "disabled"}`);
                              loadTab("toolkits");
                            } catch {
                              setNotice(`Failed to update tool ${tool.toolName}`);
                            }
                          }}
                        />
                      </div>
                    ))}
                  </Card>
                ))}
              </div>
            </div>
          )}

          {!loadingTab && tab === "knowledge" && (
            <div className="grid gap-6 xl:grid-cols-3">
              <Card className="p-4 h-fit">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      let res: Response;
                      if (uploadFile) {
                        const fd = new FormData();
                        fd.append("file", uploadFile);
                        fd.append("title", docForm.title || uploadFile.name);
                        fd.append("type", docForm.type);
                        fd.append("revision", docForm.revision);
                        fd.append("machineTypes", docForm.machineTypes);
                        fd.append("supersedePrevious", String(docForm.supersedePrevious));
                        res = await fetch("/api/admin/knowledge", { method: "POST", body: fd });
                      } else {
                        res = await fetch("/api/admin/knowledge", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            ...docForm,
                            machineTypes: docForm.machineTypes
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean)
                          })
                        });
                      }
                      if (res.ok) {
                        const d = (await res.json()) as { chunkCount: number };
                        setNotice(`Ingested document (${d.chunkCount} chunks indexed)`);
                        setUploadFile(null);
                        setDocForm({ ...docForm, title: "", rawContent: "" });
                        loadTab("knowledge");
                      } else {
                        setNotice(await readAdminError(res, "Ingestion failed"));
                      }
                    } catch {
                      setNotice("Knowledge ingestion request failed");
                    }
                  }}
                  className="space-y-3"
                >
                  <h2 className="text-sm font-semibold flex items-center gap-1.5">
                    <Upload className="h-4 w-4 text-primary" />
                    <span>Ingest Manual / SOP</span>
                  </h2>
                  <Input
                    placeholder="Document Title"
                    aria-label="Document title"
                    value={docForm.title}
                    onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      aria-label="Document type"
                      value={docForm.type}
                      onChange={(e) => setDocForm({ ...docForm, type: e.target.value })}
                    >
                      <option value="manual">manual</option>
                      <option value="sop">sop</option>
                      <option value="policy">policy</option>
                      <option value="kb">kb</option>
                      <option value="datasheet">datasheet</option>
                    </Select>
                    <Input
                      placeholder="Revision (e.g. Rev 4.3)"
                      aria-label="Document revision"
                      value={docForm.revision}
                      onChange={(e) => setDocForm({ ...docForm, revision: e.target.value })}
                    />
                  </div>
                  <Input
                    placeholder="Machine types (comma separated)"
                    aria-label="Machine types"
                    value={docForm.machineTypes}
                    onChange={(e) => setDocForm({ ...docForm, machineTypes: e.target.value })}
                  />
                  <input
                    type="file"
                    aria-label="Upload knowledge document"
                    accept=".md,.txt,.pdf,.docx"
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                    className="w-full text-xs"
                  />
                  {!uploadFile && (
                    <Textarea
                      rows={4}
                      placeholder="Or paste Markdown / text content..."
                      aria-label="Document content"
                      value={docForm.rawContent}
                      onChange={(e) => setDocForm({ ...docForm, rawContent: e.target.value })}
                    />
                  )}
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={docForm.supersedePrevious}
                      onChange={(e) =>
                        setDocForm({ ...docForm, supersedePrevious: e.target.checked })
                      }
                    />
                    <span>Supersede prior current revision with same title</span>
                  </label>
                  <Button type="submit" className="w-full">
                    Upload &amp; Index
                  </Button>
                </form>
              </Card>

              <Card className="xl:col-span-2 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title &amp; Source</TableHead>
                      <TableHead>Revision</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDocs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-8 text-center text-xs text-muted-foreground">
                          {docs.length === 0
                            ? "No knowledge documents ingested yet."
                            : "No documents match your filter."}
                        </TableCell>
                      </TableRow>
                    ) : (
                    filteredDocs.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          <div className="font-semibold">{d.title}</div>
                          <div className="text-muted-foreground">
                            {d.type} · {d.source} · Index: {d.ingestionStatus}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono">{d.revision}</TableCell>
                        <TableCell>
                          <Badge
                            variant={d.status === "current" ? "success" : "destructive"}
                            className="uppercase text-[10px]"
                          >
                            {d.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="space-x-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                const res = await fetch("/api/admin/knowledge", {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    documentId: d.id,
                                    action: d.status === "current" ? "supersede" : "activate"
                                  })
                                });
                                if (!res.ok) {
                                  setNotice(await readAdminError(res, `Failed to update ${d.title}`));
                                  return;
                                }
                                setNotice(
                                  d.status === "current"
                                    ? `Superseded ${d.title}`
                                    : `Activated ${d.title}`
                                );
                                loadTab("knowledge");
                              } catch {
                                setNotice(`Failed to update ${d.title}`);
                              }
                            }}
                          >
                            {d.status === "current" ? "Supersede" : "Make Current"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                const res = await fetch("/api/admin/knowledge", {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ documentId: d.id, action: "reindex" })
                                });
                                if (!res.ok) {
                                  setNotice(await readAdminError(res, `Failed to re-index ${d.title}`));
                                  return;
                                }
                                setNotice(`Re-indexed ${d.title}`);
                                loadTab("knowledge");
                              } catch {
                                setNotice(`Failed to re-index ${d.title}`);
                              }
                            }}
                          >
                            <RefreshCw className="h-3 w-3" />
                            <span>Re-index</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {!loadingTab && tab === "audit" && (
            <div className="space-y-3">
              <Card className="p-3 flex flex-wrap items-center justify-between gap-2">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void loadTab("audit");
                  }}
                  className="flex flex-wrap gap-2"
                >
                  <Input
                    placeholder="Filter User ID"
                    aria-label="Filter audit by user ID"
                    value={auditFilter.userId}
                    onChange={(e) => setAuditFilter({ ...auditFilter, userId: e.target.value })}
                    className="w-36"
                  />
                  <Input
                    placeholder="Filter Tool Name"
                    aria-label="Filter audit by tool name"
                    value={auditFilter.toolName}
                    onChange={(e) => setAuditFilter({ ...auditFilter, toolName: e.target.value })}
                    className="w-40"
                  />
                  <Select
                    aria-label="Filter audit by status"
                    value={auditFilter.status}
                    onChange={(e) => setAuditFilter({ ...auditFilter, status: e.target.value })}
                  >
                    <option value="">All statuses</option>
                    <option value="allowed">allowed</option>
                    <option value="denied">denied</option>
                    <option value="confirmed">confirmed</option>
                    <option value="error">error</option>
                  </Select>
                  <Button type="submit" size="sm">
                    Apply
                  </Button>
                </form>
                <a
                  href="/api/admin/audit?format=csv"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Export CSV</span>
                </a>
              </Card>

              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>User / Role</TableHead>
                      <TableHead>Tool</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAudit.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                          {auditEntries.length === 0
                            ? "No audit entries recorded yet."
                            : "No audit entries match your filter."}
                        </TableCell>
                      </TableRow>
                    ) : (
                    filteredAudit.map((entry) => (
                      <TableRow
                        key={entry.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Inspect audit entry ${entry.toolName} by ${entry.userId}`}
                        onClick={() => setSelectedAudit(entry)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedAudit(entry);
                          }
                        }}
                        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      >
                        <TableCell className="font-mono whitespace-nowrap tabular-nums">
                          {new Date(entry.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {entry.userId} ({entry.role})
                        </TableCell>
                        <TableCell className="font-mono">{entry.toolName}</TableCell>
                        <TableCell>
                          <Badge
                            variant={entry.status === "denied" ? "destructive" : "success"}
                            className="uppercase text-[10px]"
                          >
                            {entry.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">{entry.reason}</TableCell>
                      </TableRow>
                    ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {!loadingTab && tab === "usage" && usageData && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-4">
                <Card className="p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Total Agent Runs
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums mt-1">
                    {usageData.summary.totalCalls}
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Total Tokens
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums mt-1">
                    {usageData.summary.totalTokens}
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Est. LLM Cost
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums mt-1">
                    ${usageData.summary.totalCostUsd}
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Helpfulness / Fixed It
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums mt-1">
                    {usageData.summary.helpfulnessRate}% ({usageData.summary.fixedCount} fixed)
                  </div>
                </Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card className="p-4 space-y-2">
                  <h2 className="text-sm font-semibold">Usage by User</h2>
                  {usageData.byUser.filter((u) =>
                    q ? `${u.userId} ${u.role}`.toLowerCase().includes(q) : true
                  ).length === 0 ? (
                    <div className="text-xs text-muted-foreground">No usage records yet.</div>
                  ) : (
                  usageData.byUser
                    .filter((u) =>
                      q
                        ? `${u.userId} ${u.role}`.toLowerCase().includes(q)
                        : true
                    )
                    .map((u) => (
                      <div
                        key={u.userId}
                        className="flex justify-between text-xs border-b border-border/50 py-1.5 last:border-0"
                      >
                        <span>
                          {u.userId} ({u.role})
                        </span>
                        <span className="font-mono tabular-nums">
                          {u.calls} runs · {u.tokens} tok · ${u.costUsd.toFixed(4)}
                        </span>
                      </div>
                    ))
                  )}
                </Card>

                <Card className="p-4 space-y-2">
                  <h2 className="text-sm font-semibold">Flagged / Wrong Answers Review</h2>
                  {usageData.wrongAnswers.filter((w) =>
                    q
                      ? `${w.userId} ${w.comment} ${w.answerExcerpt}`
                          .toLowerCase()
                          .includes(q)
                      : true
                  ).length === 0 ? (
                    <div className="text-xs text-muted-foreground">No flagged answers match.</div>
                  ) : (
                    usageData.wrongAnswers
                      .filter((w) =>
                        q
                          ? `${w.userId} ${w.comment} ${w.answerExcerpt}`
                              .toLowerCase()
                              .includes(q)
                          : true
                      )
                      .map((w) => (
                        <div key={w.id} className="rounded-md border border-border p-2.5 text-xs space-y-1">
                          <div className="font-semibold text-destructive">
                            {w.outcome ?? "downvote"} by {w.userId}
                          </div>
                          <div>Comment: {w.comment || "—"}</div>
                          <div className="text-muted-foreground truncate">{w.answerExcerpt}</div>
                        </div>
                      ))
                  )}
                </Card>
              </div>
            </div>
          )}

          {!loadingTab && tab === "assets" && (
            <div className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-3">
                <Card className="xl:col-span-2 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset</TableHead>
                        <TableHead>Type / Model</TableHead>
                        <TableHead>Crit</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAssets.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-muted-foreground">No production lines or machines to display.</TableCell>
                        </TableRow>
                      )}
                      {filteredAssets.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>
                            <div className="font-semibold">{a.name}</div>
                            <div className="text-muted-foreground">
                              <code className="font-mono">{a.id}</code> · {a.plantId}
                            </div>
                          </TableCell>
                          <TableCell>
                            {a.type === "line" ? "Production line" : [a.machineType || "Machine", a.manufacturer, a.model].filter(Boolean).join(" · ")}
                          </TableCell>
                          <TableCell className="font-bold font-mono">{a.type === "machine" ? a.criticality : "—"}</TableCell>
                          <TableCell className="space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEditingAsset(a)}
                            >
                              Edit
                            </Button>
                            {a.type === "machine" && <Button
                              size="sm"
                              onClick={async () => {
                                try {
                                  const res = await fetch(
                                    `/api/admin/assets?qr=${encodeURIComponent(a.id)}`
                                  );
                                  if (res.ok) setQrModal(await res.json());
                                  else setNotice(await readAdminError(res, `Failed to load QR code for ${a.name}`));
                                } catch {
                                  setNotice(`Failed to load QR code for ${a.name}`);
                                }
                              }}
                            >
                              <QrCode className="h-3 w-3" />
                              <span>QR</span>
                            </Button>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>

                {editingAsset ? (
                  <Card className="p-4 h-fit">
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        try {
                          const response = await fetch("/api/admin/assets", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              id: editingAsset.id,
                              name: editingAsset.name,
                              manufacturer: editingAsset.manufacturer,
                              model: editingAsset.model,
                              criticality: editingAsset.criticality
                            })
                          });
                          if (!response.ok) {
                            setNotice(await readAdminError(response, "Asset update failed."));
                            return;
                          }
                          setNotice(`Updated asset ${editingAsset.id}`);
                          setEditingAsset(null);
                          loadTab("assets");
                        } catch {
                          setNotice("Asset update request failed.");
                        }
                      }}
                      className="space-y-3"
                    >
                      <h2 className="text-sm font-semibold">Edit Asset Metadata</h2>
                      <Input
                        aria-label="Name"
                        value={editingAsset.name}
                        onChange={(e) =>
                          setEditingAsset({ ...editingAsset, name: e.target.value })
                        }
                      />
                      {editingAsset.type === "machine" && (
                        <>
                          <Input
                            aria-label="Manufacturer"
                            value={editingAsset.manufacturer}
                            onChange={(e) =>
                              setEditingAsset({ ...editingAsset, manufacturer: e.target.value })
                            }
                          />
                          <Input
                            aria-label="Model"
                            value={editingAsset.model}
                            onChange={(e) =>
                              setEditingAsset({ ...editingAsset, model: e.target.value })
                            }
                          />
                          <Select
                            aria-label="Criticality"
                            value={editingAsset.criticality}
                            onChange={(e) =>
                              setEditingAsset({
                                ...editingAsset,
                                criticality: e.target.value as "A" | "B" | "C"
                              })
                            }
                            className="w-full"
                          >
                            <option value="A">Criticality A</option>
                            <option value="B">Criticality B</option>
                            <option value="C">Criticality C</option>
                          </Select>
                        </>
                      )}
                      <div className="flex gap-2">
                        <Button type="submit">Save Asset</Button>
                        <Button type="button" variant="outline" onClick={() => setEditingAsset(null)}>Cancel</Button>
                      </div>
                    </form>
                  </Card>
                ) : (
                  <AssetCreateForm
                    plants={assetPlants}
                    lines={assetsData.filter((asset) => asset.type === "line")}
                    onCreated={(name) => {
                      setNotice(`Added ${name}`);
                      void loadTab("assets");
                    }}
                  />
                )}
              </div>

              <div className="grid gap-6 xl:grid-cols-3">
                <Card className="xl:col-span-2 p-4 space-y-3 overflow-hidden">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold">Plant-Scoped Gateway Ingestion Tokens</h2>
                      <p className="text-xs text-muted-foreground">
                        Dedicated Bearer credentials (<code className="font-mono">kjt_...</code>) for edge telemetry gateways writing to <code className="font-mono">POST /api/telemetry</code>.
                      </p>
                    </div>
                    <Badge variant="outline" className="tabular-nums">
                      {ingestionTokensData.filter((tok) => tok.active).length} active
                    </Badge>
                  </div>

                  {revealedToken && (
                    <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-emerald-900 dark:text-emerald-200">
                          Copy token now ({revealedToken.name} · {revealedToken.plantId}) — shown once only
                        </span>
                        <button
                          type="button"
                          onClick={() => setRevealedToken(null)}
                          aria-label="Dismiss revealed ingestion token"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <pre className="rounded border border-border bg-background p-2 font-mono text-[11px] overflow-x-auto">
                        {revealedToken.token}
                      </pre>
                    </div>
                  )}

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Gateway Name</TableHead>
                        <TableHead>Plant</TableHead>
                        <TableHead>Prefix</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last Used</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ingestionTokensData.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-muted-foreground">
                            No ingestion tokens issued yet. Create one for a plant gateway on the right.
                          </TableCell>
                        </TableRow>
                      ) : (
                        ingestionTokensData.map((tok) => {
                          const expired = Boolean(tok.expiresAt && new Date(tok.expiresAt).getTime() <= Date.now());
                          const statusLabel = !tok.active ? "Revoked" : expired ? "Expired" : "Active";
                          return (
                            <TableRow key={tok.id}>
                              <TableCell className="font-medium">{tok.name}</TableCell>
                              <TableCell className="font-mono">{tok.plantId}</TableCell>
                              <TableCell className="font-mono">{tok.tokenPrefix}...</TableCell>
                              <TableCell>
                                <Badge
                                  variant={statusLabel === "Active" ? "success" : statusLabel === "Expired" ? "warning" : "outline"}
                                  className="uppercase text-[10px]"
                                >
                                  {statusLabel}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground tabular-nums">
                                {tok.lastUsedAt ? new Date(tok.lastUsedAt).toISOString().slice(0, 16).replace("T", " ") : "Never"}
                              </TableCell>
                              <TableCell className="space-x-1.5">
                                {tok.active && (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={async () => {
                                        try {
                                          const res = await fetch("/api/admin/ingestion-tokens", {
                                            method: "PATCH",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ id: tok.id, action: "rotate" })
                                          });
                                          if (res.ok) {
                                            const data = (await res.json()) as { token: string; record: IngestionTokenRow };
                                            setRevealedToken({ token: data.token, name: data.record.name, plantId: data.record.plantId });
                                            setNotice(`Rotated ingestion token for ${tok.name}`);
                                            await loadTab("assets");
                                          } else {
                                            setNotice(await readAdminError(res, `Failed to rotate ingestion token ${tok.name}`));
                                          }
                                        } catch {
                                          setNotice(`Failed to rotate ingestion token ${tok.name}`);
                                        }
                                      }}
                                    >
                                      Rotate
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={async () => {
                                        try {
                                          const res = await fetch("/api/admin/ingestion-tokens", {
                                            method: "PATCH",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ id: tok.id, action: "revoke" })
                                          });
                                          if (res.ok) {
                                            setNotice(`Revoked ingestion token ${tok.name}`);
                                            await loadTab("assets");
                                          } else {
                                            setNotice(await readAdminError(res, `Failed to revoke ingestion token ${tok.name}`));
                                          }
                                        } catch {
                                          setNotice(`Failed to revoke ingestion token ${tok.name}`);
                                        }
                                      }}
                                    >
                                      Revoke
                                    </Button>
                                  </>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </Card>

                <Card className="p-4 h-fit">
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        const res = await fetch("/api/admin/ingestion-tokens", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            plantId: tokenForm.plantId || assetPlants[0]?.id,
                            name: tokenForm.name,
                            ...(tokenForm.expiresInDays ? { expiresInDays: Number(tokenForm.expiresInDays) } : {})
                          })
                        });
                        const data = (await res.json().catch(() => ({}))) as {
                          token?: string;
                          record?: IngestionTokenRow;
                          detail?: string;
                        };
                        if (!res.ok || !data.token || !data.record) {
                          setNotice(data.detail ?? "Failed to issue ingestion token.");
                          return;
                        }
                        setRevealedToken({ token: data.token, name: data.record.name, plantId: data.record.plantId });
                        setTokenForm((prev) => ({ ...prev, name: "" }));
                        setNotice(`Issued ingestion token for ${data.record.plantId}`);
                        await loadTab("assets");
                      } catch {
                        setNotice("Failed to issue ingestion token.");
                      }
                    }}
                    className="space-y-3"
                  >
                    <h2 className="text-sm font-semibold">Issue Gateway Token</h2>
                    <Select
                      aria-label="Ingestion token plant"
                      value={tokenForm.plantId || assetPlants[0]?.id || ""}
                      onChange={(e) => setTokenForm({ ...tokenForm, plantId: e.target.value })}
                    >
                      {assetPlants.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.id})
                        </option>
                      ))}
                    </Select>
                    <Input
                      required
                      minLength={2}
                      placeholder="Gateway label (e.g. Detroit OPC-UA Collector)"
                      aria-label="Gateway label"
                      value={tokenForm.name}
                      onChange={(e) => setTokenForm({ ...tokenForm, name: e.target.value })}
                    />
                    <Input
                      type="number"
                      min={1}
                      max={730}
                      placeholder="Expiry in days (optional)"
                      aria-label="Expiry in days"
                      value={tokenForm.expiresInDays}
                      onChange={(e) => setTokenForm({ ...tokenForm, expiresInDays: e.target.value })}
                    />
                    <Button type="submit" className="w-full" disabled={assetPlants.length === 0}>
                      Issue Ingestion Token
                    </Button>
                  </form>
                </Card>
              </div>
            </div>
          )}

          {!loadingTab && tab === "diagnostics" && (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  {diagnosticsData
                    ? `Snapshot captured at ${new Date(diagnosticsData.checkedAt).toISOString().slice(0, 19).replace("T", " ")} UTC`
                    : "Loading system diagnostics..."}
                </div>
                <Button variant="outline" size="sm" onClick={() => loadTab("diagnostics")}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Refresh Diagnostics</span>
                </Button>
              </div>

              {diagnosticsData && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Card className="p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Database Health
                      </div>
                      <div className="text-lg font-bold font-mono tabular-nums mt-1">
                        {diagnosticsData.database.status.toUpperCase()} ({diagnosticsData.database.latencyMs}ms)
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {diagnosticsData.database.pool
                          ? `Pool ${diagnosticsData.database.pool.totalCount ?? 0} total / ${diagnosticsData.database.pool.waitingCount ?? 0} waiting`
                          : "Embedded PGlite driver"}
                      </div>
                    </Card>

                    <Card className="p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Malware Scanner (ClamAV)
                      </div>
                      <div className="text-lg font-bold font-mono mt-1 uppercase">
                        {diagnosticsData.scanner.status}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1 truncate">
                        {diagnosticsData.scanner.version ?? diagnosticsData.scanner.detail ?? "Check CLAMAV_HOST"}
                      </div>
                    </Card>

                    <Card className="p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Telemetry Freshness
                      </div>
                      <div className="text-lg font-bold font-mono tabular-nums mt-1">
                        {diagnosticsData.telemetry.machinesWithTelemetry}/{diagnosticsData.telemetry.totalMachines} Active
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {diagnosticsData.telemetry.staleMachines} stale · {diagnosticsData.telemetry.missingTelemetry} awaiting first reading
                      </div>
                    </Card>

                    <Card className="p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Queue Backlog &amp; Runtime
                      </div>
                      <div className="text-lg font-bold font-mono tabular-nums mt-1">
                        {diagnosticsData.queues.ready} ready / {diagnosticsData.queues.deadLetter} DLQ
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Runtime ticks: {diagnosticsData.runtime.tickCount}
                        {diagnosticsData.runtime.lastTickError ? " (last tick had error)" : ""}
                      </div>
                    </Card>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-2">
                    <Card className="p-4 space-y-3 overflow-hidden">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold">Schema Migrations</h2>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          v{diagnosticsData.migrations.currentVersion}
                        </Badge>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Version</TableHead>
                            <TableHead>Migration</TableHead>
                            <TableHead>Applied At</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {diagnosticsData.migrations.applied.map((m) => (
                            <TableRow key={m.version}>
                              <TableCell className="font-mono">v{m.version}</TableCell>
                              <TableCell className="font-mono">{m.name}</TableCell>
                              <TableCell className="text-muted-foreground tabular-nums">
                                {new Date(m.appliedAt).toISOString().slice(0, 19).replace("T", " ")} UTC
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Card>

                    <Card className="p-4 space-y-3 h-fit">
                      <div>
                        <h2 className="text-sm font-semibold">Tenant Data Retention Cleanup</h2>
                        <p className="text-xs text-muted-foreground">
                          Prunes readings, audit logs, telemetry usage logs, finished workflow runs, and read notifications older than the retention window for this tenant only.
                        </p>
                      </div>
                      <div className="flex items-end gap-2">
                        <div className="space-y-1 flex-1">
                          <label className="text-xs font-medium" htmlFor="retention-days-input">
                            Retention Window (days)
                          </label>
                          <Input
                            id="retention-days-input"
                            type="number"
                            min={1}
                            max={3650}
                            value={retentionDaysInput}
                            onChange={(e) => setRetentionDaysInput(e.target.value)}
                          />
                        </div>
                        <Button
                          disabled={runningRetention}
                          onClick={async () => {
                            setRunningRetention(true);
                            try {
                              const res = await fetch("/api/admin/retention", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  retentionDays: Math.min(Math.max(Number(retentionDaysInput) || 90, 1), 3650)
                                })
                              });
                              const summary = await res.json().catch(() => ({}));
                              if (res.ok) {
                                setRetentionResult(summary);
                                setNotice(`Retention cleanup completed for tenant.`);
                              } else {
                                setNotice((summary as { detail?: string }).detail ?? "Retention cleanup failed.");
                              }
                            } catch {
                              setNotice("Retention cleanup request failed.");
                            } finally {
                              setRunningRetention(false);
                            }
                          }}
                        >
                          {runningRetention ? "Running..." : "Run Retention Cleanup"}
                        </Button>
                      </div>
                      {retentionResult && (
                        <pre className="rounded-md border border-border bg-muted/50 p-2.5 text-[11px] font-mono overflow-x-auto">
                          {JSON.stringify(retentionResult, null, 2)}
                        </pre>
                      )}
                    </Card>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={Boolean(resetTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setResetTarget(null);
            setResetPassword("");
            setResetError(null);
          }
        }}
        ariaLabel="Reset User Password"
        className="max-w-sm p-5 space-y-4"
      >
        {resetTarget && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setResetError(null);
              setResettingPw(true);
              try {
                const res = await fetch("/api/admin/users", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userId: resetTarget.id, password: resetPassword })
                });
                const d = (await res.json().catch(() => ({}))) as { detail?: string };
                if (!res.ok) {
                  setResetError(d.detail ?? `Password reset failed for ${resetTarget.email}`);
                  return;
                }
                setNotice(`Password reset and sessions revoked for ${resetTarget.email}`);
                setResetTarget(null);
                setResetPassword("");
                setResetError(null);
                loadTab("users");
              } catch {
                setResetError(`Password reset request failed for ${resetTarget.email}`);
              } finally {
                setResettingPw(false);
              }
            }}
            className="space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Reset Password: {resetTarget.email}</h3>
              <button
                type="button"
                onClick={() => {
                  setResetTarget(null);
                  setResetPassword("");
                  setResetError(null);
                }}
                aria-label="Close reset password dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Sets a new password (min 12 chars, unique characters) and invalidates all active sessions for this user.
            </p>
            <Input
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              placeholder="New password (min 12 chars)"
              aria-label="Reset user password"
              value={resetPassword}
              onChange={(e) => {
                setResetPassword(e.target.value);
                if (resetError) setResetError(null);
              }}
            />
            {resetError && (
              <p role="alert" className="text-xs text-destructive">
                {resetError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setResetTarget(null);
                  setResetPassword("");
                  setResetError(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={resettingPw || resetPassword.length < 12}>
                {resettingPw ? "Resetting..." : "Reset Password"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog
        open={Boolean(selectedAudit)}
        onOpenChange={(open) => !open && setSelectedAudit(null)}
        variant="drawer-right"
        ariaLabel="Audit Record Details"
        className="max-w-md p-5 space-y-3"
      >
        {selectedAudit && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Audit Record {selectedAudit.id}</h3>
              <button
                type="button"
                onClick={() => setSelectedAudit(null)}
                aria-label="Close audit record drawer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="text-xs space-y-2">
              <div><strong>Tool:</strong> <code className="font-mono">{selectedAudit.toolName}</code></div>
              <div><strong>Status:</strong> {selectedAudit.status}</div>
              <div><strong>User:</strong> {selectedAudit.userId} ({selectedAudit.role})</div>
              <div><strong>Reason:</strong> {selectedAudit.reason}</div>
              <div><strong>Result Hash:</strong> <code className="font-mono">{selectedAudit.resultHash || "—"}</code></div>
              <div><strong>Arguments:</strong></div>
              <pre className="rounded-md border border-border bg-muted/50 p-2.5 overflow-x-auto font-mono">
                {JSON.stringify(selectedAudit.args, null, 2)}
              </pre>
            </div>
          </>
        )}
      </Dialog>

      <Dialog
        open={Boolean(qrModal)}
        onOpenChange={(open) => !open && setQrModal(null)}
        ariaLabel="Machine QR Label"
        className="max-w-sm p-6 text-center space-y-4"
      >
        {qrModal && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Machine QR Label</h3>
              <button
                type="button"
                onClick={() => setQrModal(null)}
                aria-label="Close QR label dialog"
                className="no-print"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Generated QR SVG is displayed as an image, never inserted as document HTML. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="mx-auto w-56 h-56 bg-white p-2 rounded-md border"
              alt="Machine QR code"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrModal.svg)}`}
            />
            <div className="text-xs font-mono break-all">{qrModal.url}</div>
            <Button onClick={() => window.print()} className="no-print">
              <Printer className="h-3.5 w-3.5" />
              <span>Print Label</span>
            </Button>
          </>
        )}
      </Dialog>
    </div>
  );
}
