"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Responsive, WidthProvider, type Layout, type Layouts } from "react-grid-layout";
import { toPng } from "html-to-image";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  ArrowLeft,
  Camera,
  History,
  Lock,
  Plus,
  Printer,
  Redo2,
  Save,
  Settings,
  Share2,
  Sparkles,
  Table as TableIcon,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import { listMetrics } from "@kojo/core/metrics";
import type {
  DashboardSpec,
  DashboardWidget,
  SemanticDimension,
  TimeRange,
  WidgetType
} from "@kojo/core/dashboard";
import { useAppContext } from "./providers";
import { MachineStatusBadge } from "./machine-status-badge";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";

const ResponsiveGrid = WidthProvider(Responsive) as unknown as React.ComponentType<
  React.PropsWithChildren<{
    className?: string;
    layouts: Layouts;
    breakpoints: Record<string, number>;
    cols: Record<string, number>;
    rowHeight: number;
    isDraggable?: boolean;
    isResizable?: boolean;
    onBreakpointChange?: (newBreakpoint: string) => void;
    onLayoutChange?: (layout: Layout[], allLayouts: Layouts) => void;
  }>
>;

const CHART_COLORS = ["#c2410c", "#0369a1", "#15803d", "#7e22ce", "#a16207", "#b91c1c"];

interface EvaluatedWidgetData {
  widgetId: string;
  locked: boolean;
  lockReason?: string;
  metricResult?: {
    metric: { id: string; label: string; unit: string };
    summaryValue: number;
    previousSummaryValue?: number;
    rows: Array<{ dimension: string; value: number; unit: string; previousValue?: number }>;
  };
  statusGrid?: Array<{
    id: string;
    name: string;
    plantId: string;
    machineType: string;
    status: string;
  }>;
  content?: string;
}

interface VersionRecord {
  id: string;
  version: number;
  changeSummary: string;
  createdAt: string;
}

function WidgetRenderer({
  widget,
  data
}: {
  widget: DashboardWidget;
  data?: EvaluatedWidgetData;
}) {
  const [tableMode, setTableMode] = useState(false);

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground animate-pulse">
        Loading widget...
      </div>
    );
  }

  if (data.locked) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-4 bg-muted/40 rounded-md border border-dashed border-border gap-2">
        <Lock className="h-5 w-5 text-muted-foreground" />
        <div className="text-xs font-semibold">Restricted Widget</div>
        <div className="text-[11px] text-muted-foreground max-w-xs">
          {data.lockReason ?? "Your role or plant scope cannot access this metric."}
        </div>
      </div>
    );
  }

  if (widget.type === "text") {
    return (
      <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
        {data.content || widget.content || "Text block"}
      </div>
    );
  }

  if (widget.type === "status_grid") {
    const items = data.statusGrid ?? [];
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 overflow-y-auto max-h-full">
        {items.map((m) => (
          <Link
            key={m.id}
            href={`/m/${m.id}`}
            className="rounded-md border border-border p-2 hover:border-primary/60 text-xs space-y-1 transition-colors"
          >
            <div className="font-semibold truncate">{m.name}</div>
            <MachineStatusBadge status={m.status} size="sm" />
          </Link>
        ))}
      </div>
    );
  }

  const res = data.metricResult;
  if (!res) {
    return <div className="text-xs text-muted-foreground">No data available.</div>;
  }

  if (widget.type === "kpi") {
    const delta =
      typeof res.previousSummaryValue === "number" && res.previousSummaryValue !== 0
        ? Number((res.summaryValue - res.previousSummaryValue).toFixed(2))
        : null;
    return (
      <div className="h-full flex flex-col justify-center gap-1">
        <div className="text-3xl font-bold tracking-tight font-mono tabular-nums">
          {res.summaryValue}{" "}
          <span className="text-base font-normal text-muted-foreground">
            {res.metric.unit}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground tabular-nums">
          {typeof widget.target === "number" && (
            <span>
              Target: <strong>{widget.target} {res.metric.unit}</strong>
            </span>
          )}
          {delta !== null && (
            <span className={delta >= 0 ? "text-emerald-600" : "text-red-600"}>
              {delta >= 0 ? `+${delta}` : delta} vs prev
            </span>
          )}
        </div>
      </div>
    );
  }

  if (widget.type === "gauge") {
    const pct = Math.min(Math.max(res.summaryValue, 0), 100);
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <div className="relative h-24 w-44 overflow-hidden">
          <svg viewBox="0 0 180 100" className="w-full h-full" aria-label={`${widget.title} gauge`}>
            <path
              d="M 15 90 A 75 75 0 0 1 165 90"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.15"
              strokeWidth="14"
              strokeLinecap="round"
            />
            <path
              d="M 15 90 A 75 75 0 0 1 165 90"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 235} 240`}
            />
          </svg>
          <div className="absolute inset-x-0 bottom-1 text-center font-mono text-xl font-bold tabular-nums">
            {res.summaryValue} {res.metric.unit}
          </div>
        </div>
        {typeof widget.target === "number" && (
          <div className="text-xs text-muted-foreground tabular-nums">
            Target: {widget.target} {res.metric.unit}
          </div>
        )}
      </div>
    );
  }

  const rows = res.rows;
  if (widget.type === "table" || tableMode) {
    return (
      <div className="overflow-auto max-h-full">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Segment</th>
              <th className="py-1.5 font-medium">Value ({res.metric.unit})</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="py-1.5 pr-2">{r.dimension}</td>
                <td className="py-1.5 font-mono tabular-nums">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (widget.type === "heatmap") {
    const maxVal = Math.max(...rows.map((r) => r.value), 1);
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 overflow-y-auto max-h-full">
        {rows.map((r, i) => {
          const ratio = Math.min(Math.max(r.value / maxVal, 0.2), 1);
          return (
            <div
              key={i}
              className="rounded-md p-2 text-xs text-white font-semibold"
              style={{ backgroundColor: `rgba(194, 65, 12, ${ratio.toFixed(2)})` }}
            >
              <div className="truncate">{r.dimension}</div>
              <div className="font-mono tabular-nums">{r.value} {res.metric.unit}</div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex justify-end mb-1 no-print">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTableMode((v) => !v)}
          className="h-6 px-2 text-[10px]"
          aria-label={`Data table fallback for ${widget.title}`}
        >
          <TableIcon className="h-3 w-3" />
          <span>Table</span>
        </Button>
      </div>
      <div className="flex-1 min-h-[140px]" role="img" aria-label={widget.title}>
        <ResponsiveContainer width="100%" height="100%">
          {widget.type === "line" ? (
            <LineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.22} />
              <XAxis dataKey="dimension" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} />
            </LineChart>
          ) : widget.type === "pie" ? (
            <PieChart>
              <Pie
                data={rows}
                dataKey="value"
                nameKey="dimension"
                outerRadius={70}
                label={(entry) => entry.dimension}
              >
                {rows.map((_, idx) => (
                  <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          ) : widget.type === "stacked_bar" ? (
            <BarChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.22} />
              <XAxis dataKey="dimension" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="value" stackId="a" fill="hsl(var(--primary))" />
              {rows.some((r) => typeof r.previousValue === "number") && (
                <Bar dataKey="previousValue" stackId="a" fill="#0369a1" />
              )}
            </BarChart>
          ) : (
            <BarChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.22} />
              <XAxis dataKey="dimension" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const MAX_UNDO_HISTORY = 5;

function layoutsEqual(
  a: DashboardSpec["layout"],
  b: DashboardSpec["layout"]
): boolean {
  if (a.length !== b.length) return false;
  const mapA = new Map(a.map((item) => [item.i, item]));
  for (const item of b) {
    const prev = mapA.get(item.i);
    if (
      !prev ||
      prev.x !== item.x ||
      prev.y !== item.y ||
      prev.w !== item.w ||
      prev.h !== item.h
    ) {
      return false;
    }
  }
  return true;
}

export function DashboardWorkspace({
  dashboardId,
  initialSpec,
  canEdit,
  initialShares
}: {
  dashboardId: string;
  initialSpec: DashboardSpec;
  canEdit: boolean;
  initialShares: Array<{ shareType: "role" | "plant"; targetId: string }>;
}) {
  const { user, t } = useAppContext();
  const [spec, setSpec] = useState<DashboardSpec>(initialSpec);
  const [historyState, setHistoryState] = useState<{
    entries: DashboardSpec[];
    index: number;
  }>({ entries: [initialSpec], index: 0 });
  const specRef = useRef<DashboardSpec>(spec);
  specRef.current = spec;

  const [globalRange, setGlobalRange] = useState<TimeRange>(initialSpec.filters.range ?? "7d");
  const [globalPlant, setGlobalPlant] = useState<string>(initialSpec.filters.plantId ?? "");
  const [widgetData, setWidgetData] = useState<Record<string, EvaluatedWidgetData>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeBreakpoint, setActiveBreakpoint] = useState("lg");
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [refining, setRefining] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [shares, setShares] = useState(initialShares);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const widgetRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastCoalesceRef = useRef<string | null>(null);
  const allMetrics = listMetrics();

  const pushSpec = (next: DashboardSpec, coalesceKey?: string) => {
    const shouldReplace =
      Boolean(coalesceKey) && lastCoalesceRef.current === coalesceKey;
    lastCoalesceRef.current = coalesceKey ?? null;
    setHistoryState((prev) => {
      if (shouldReplace && prev.index >= 0 && prev.entries[prev.index]) {
        const updated = [...prev.entries];
        updated[prev.index] = next;
        return { entries: updated, index: prev.index };
      }
      const entries = [...prev.entries.slice(0, prev.index + 1), next].slice(
        -MAX_UNDO_HISTORY
      );
      return { entries, index: entries.length - 1 };
    });
    specRef.current = next;
    setSpec(next);
    setDirty(true);
  };

  const evaluateData = async (specToEval: DashboardSpec) => {
    const res = await fetch(`/api/dashboards/${dashboardId}/data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        range: globalRange,
        plantId: globalPlant || undefined,
        specOverride: canEdit ? specToEval : undefined
      })
    });
    if (res.ok) {
      const data = (await res.json()) as { widgetData: Record<string, EvaluatedWidgetData> };
      setWidgetData(data.widgetData);
    }
  };

  useEffect(() => {
    evaluateData(specRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalRange, globalPlant, spec.widgets, spec.filters]);

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec,
          changeSummary: "Saved from Visual Dashboard Editor"
        })
      });
      if (res.ok) {
        const data = (await res.json()) as { spec: DashboardSpec; version: number };
        specRef.current = data.spec;
        setSpec(data.spec);
        setDirty(false);
        setStatusMsg(`Saved version v${data.version}`);
      } else {
        const err = (await res.json()) as { detail?: string };
        setStatusMsg(err.detail ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleExportPng = async (widgetId: string, title: string) => {
    const node = widgetRefs.current[widgetId];
    if (!node) return;
    const dataUrl = await toPng(node, { backgroundColor: "#ffffff" });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
    a.click();
  };

  const handleRefine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !aiPrompt.trim()) return;
    setRefining(true);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: aiPrompt, spec })
      });
      if (res.ok) {
        const data = (await res.json()) as { spec: DashboardSpec; summary: string };
        pushSpec(data.spec);
        setAiPrompt("");
        setStatusMsg(data.summary);
      }
    } finally {
      setRefining(false);
    }
  };

  const loadVersions = async () => {
    const res = await fetch(`/api/dashboards/${dashboardId}/versions`);
    if (res.ok) {
      const data = (await res.json()) as { versions: VersionRecord[] };
      setVersions(data.versions);
    }
    setVersionsOpen(true);
  };

  const restoreVersion = async (version: number) => {
    const res = await fetch(`/api/dashboards/${dashboardId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version })
    });
    if (res.ok) {
      const data = (await res.json()) as { spec: DashboardSpec; version: number };
      pushSpec(data.spec);
      setDirty(false);
      setVersionsOpen(false);
      setStatusMsg(`Restored v${version} as v${data.version}`);
    }
  };

  const saveShares = async () => {
    const res = await fetch(`/api/dashboards/${dashboardId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares })
    });
    if (res.ok) {
      setShareOpen(false);
      setStatusMsg("Sharing permissions updated");
    }
  };

  const selectedWidget = spec.widgets.find((w) => w.id === selectedWidgetId) ?? null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 space-y-4">
      <Card className="no-print p-3.5 sm:p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dashboards"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Dashboards</span>
            </Link>
            <Badge variant="secondary" className="font-mono">
              v{spec.version}
            </Badge>
            {!canEdit && (
              <Badge variant="warning">{t("dashboard.readOnly")}</Badge>
            )}
            {dirty && <Badge variant="default">Unsaved changes</Badge>}
          </div>

          {canEdit ? (
            <input
              type="text"
              value={spec.title}
              aria-label="Dashboard title"
              onChange={(e) =>
                pushSpec({ ...spec, title: e.target.value }, "dashboard-title")
              }
              onBlur={() => {
                lastCoalesceRef.current = null;
              }}
              className="text-lg sm:text-xl font-bold bg-transparent border-b border-transparent focus:border-primary outline-none w-full max-w-xl"
            />
          ) : (
            <h1 className="text-lg sm:text-xl font-bold tracking-tight">{spec.title}</h1>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Scope Filters */}
          <Select
            aria-label="Global time range"
            value={globalRange}
            onChange={(e) => setGlobalRange(e.target.value as TimeRange)}
          >
            <option value="shift">This Shift</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </Select>

          <Select
            aria-label="Plant scope filter"
            value={globalPlant}
            onChange={(e) => setGlobalPlant(e.target.value)}
          >
            <option value="">All Authorized Plants</option>
            {(user?.plantIds ?? []).map((pid) => (
              <option key={pid} value={pid}>
                {pid}
              </option>
            ))}
          </Select>

          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Print</span>
          </Button>

          {canEdit && (
            <>
              <div className="inline-flex items-center rounded-md border border-border bg-background">
                <button
                  type="button"
                  disabled={historyState.index <= 0}
                  onClick={() => {
                    const idx = historyState.index - 1;
                    const target = historyState.entries[idx];
                    if (!target) return;
                    lastCoalesceRef.current = null;
                    setHistoryState((prev) => ({ ...prev, index: idx }));
                    specRef.current = target;
                    setSpec(target);
                  }}
                  className="p-2 disabled:opacity-40 hover:bg-muted rounded-l-md border-r border-border"
                  title="Undo"
                  aria-label="Undo"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={historyState.index >= historyState.entries.length - 1}
                  onClick={() => {
                    const idx = historyState.index + 1;
                    const target = historyState.entries[idx];
                    if (!target) return;
                    lastCoalesceRef.current = null;
                    setHistoryState((prev) => ({ ...prev, index: idx }));
                    specRef.current = target;
                    setSpec(target);
                  }}
                  className="p-2 disabled:opacity-40 hover:bg-muted rounded-r-md"
                  title="Redo"
                  aria-label="Redo"
                >
                  <Redo2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const id = `w-${Date.now().toString().slice(-4)}`;
                  const nextY = spec.layout.reduce(
                    (max, l) => Math.max(max, l.y + l.h),
                    0
                  );
                  const nextWidget: DashboardWidget = {
                    id,
                    type: "bar",
                    title: "New Metric Widget",
                    metric: "oee",
                    groupBy: "line",
                    range: globalRange,
                    sort: "desc",
                    limit: 12
                  };
                  pushSpec({
                    ...spec,
                    widgets: [...spec.widgets, nextWidget],
                    layout: [...spec.layout, { i: id, x: 0, y: nextY, w: 6, h: 5 }]
                  });
                  setSelectedWidgetId(id);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Widget</span>
              </Button>
              <Button variant="outline" size="sm" onClick={loadVersions}>
                <History className="h-3.5 w-3.5" />
                <span>Versions (Max 5)</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
                <Share2 className="h-3.5 w-3.5" />
                <span>Share</span>
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? "Saving..." : t("dashboard.saveVersion")}</span>
              </Button>
            </>
          )}
        </div>
      </Card>

      {statusMsg && (
        <div className="no-print rounded-md border border-border bg-muted/60 px-3.5 py-2 text-xs font-medium flex justify-between items-center">
          <span>{statusMsg}</span>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            aria-label="Dismiss status message"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0">
          <ResponsiveGrid
            className="layout"
            layouts={{
              lg: spec.layout as Layout[],
              md: spec.layout as Layout[],
              sm: spec.layout.map((l, idx) => ({
                ...l,
                x: (idx % 2) * 3,
                w: 3
              })) as Layout[],
              xs: spec.layout.map((l, idx) => ({
                ...l,
                x: 0,
                y: idx * l.h,
                w: 1
              })) as Layout[]
            }}
            breakpoints={{ lg: 1024, md: 768, sm: 520, xs: 0 }}
            cols={{ lg: 12, md: 12, sm: 6, xs: 1 }}
            rowHeight={54}
            isDraggable={canEdit && (activeBreakpoint === "lg" || activeBreakpoint === "md")}
            isResizable={canEdit && (activeBreakpoint === "lg" || activeBreakpoint === "md")}
            onBreakpointChange={(bp) => setActiveBreakpoint(bp)}
            onLayoutChange={(nextLayout) => {
              if (!canEdit || (activeBreakpoint !== "lg" && activeBreakpoint !== "md")) {
                return;
              }
              const cleaned = nextLayout.map((l) => ({
                i: l.i,
                x: l.x,
                y: l.y,
                w: l.w,
                h: l.h
              }));
              if (layoutsEqual(specRef.current.layout, cleaned)) return;
              pushSpec({ ...specRef.current, layout: cleaned });
            }}
          >
            {spec.widgets.map((w) => (
              <div
                key={w.id}
                ref={(el) => {
                  widgetRefs.current[w.id] = el;
                }}
                className={`rounded-lg border bg-card p-3.5 flex flex-col shadow-sm overflow-hidden ${
                  selectedWidgetId === w.id ? "border-primary ring-1 ring-primary" : "border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/60 mb-2">
                  <div className="font-semibold text-xs sm:text-sm truncate">
                    {w.title}
                  </div>
                  <div className="flex items-center gap-1 no-print">
                    <button
                      type="button"
                      onClick={() => handleExportPng(w.id, w.title)}
                      title="Export PNG"
                      aria-label={`Export ${w.title} as PNG`}
                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                    >
                      <Camera className="h-3.5 w-3.5" />
                    </button>
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedWidgetId((prev) => (prev === w.id ? null : w.id))
                          }
                          title="Configure widget"
                          aria-label={`Configure ${w.title}`}
                          className="p-1 rounded hover:bg-muted text-muted-foreground"
                        >
                          <Settings className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (spec.widgets.length <= 1) return;
                            pushSpec({
                              ...spec,
                              widgets: spec.widgets.filter((item) => item.id !== w.id),
                              layout: spec.layout.filter((l) => l.i !== w.id)
                            });
                          }}
                          title="Remove widget"
                          aria-label={`Remove ${w.title}`}
                          className="p-1 rounded hover:bg-muted text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  <WidgetRenderer widget={w} data={widgetData[w.id]} />
                </div>
              </div>
            ))}
          </ResponsiveGrid>
        </div>

        {canEdit && (
          <aside className="no-print w-full lg:w-80 shrink-0 space-y-4">
            <Card className="p-4">
              <form onSubmit={handleRefine} className="space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span>Refine Dashboard with AI</span>
                </div>
                <Input
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder='e.g. "make it a stacked bar by reason code"'
                />
                <Button
                  type="submit"
                  disabled={refining || !aiPrompt.trim()}
                  className="w-full"
                >
                  {refining ? "Refining..." : "Apply AI Refinement"}
                </Button>
              </form>
            </Card>

            {selectedWidget && (
              <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Widget Configuration</span>
                  <button
                    type="button"
                    onClick={() => setSelectedWidgetId(null)}
                    aria-label="Close widget config"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="space-y-1">
                  <Label>Title</Label>
                  <Input
                    value={selectedWidget.title}
                    onChange={(e) =>
                      pushSpec(
                        {
                          ...spec,
                          widgets: spec.widgets.map((item) =>
                            item.id === selectedWidget.id
                              ? { ...item, title: e.target.value }
                              : item
                          )
                        },
                        `widget-title:${selectedWidget.id}`
                      )
                    }
                    onBlur={() => {
                      lastCoalesceRef.current = null;
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <Label>Widget Type</Label>
                  <Select
                    value={selectedWidget.type}
                    onChange={(e) =>
                      pushSpec({
                        ...spec,
                        widgets: spec.widgets.map((item) =>
                          item.id === selectedWidget.id
                            ? { ...item, type: e.target.value as WidgetType }
                            : item
                        )
                      })
                    }
                    className="w-full"
                  >
                    {[
                      "kpi",
                      "line",
                      "bar",
                      "stacked_bar",
                      "pie",
                      "table",
                      "gauge",
                      "heatmap",
                      "status_grid",
                      "text"
                    ].map((wt) => (
                      <option key={wt} value={wt}>
                        {wt}
                      </option>
                    ))}
                  </Select>
                </div>

                {selectedWidget.type !== "text" && selectedWidget.type !== "status_grid" && (
                  <>
                    <div className="space-y-1">
                      <Label>Semantic Metric</Label>
                      <Select
                        value={selectedWidget.metric ?? "oee"}
                        onChange={(e) =>
                          pushSpec({
                            ...spec,
                            widgets: spec.widgets.map((item) =>
                              item.id === selectedWidget.id
                                ? { ...item, metric: e.target.value }
                                : item
                            )
                          })
                        }
                        className="w-full"
                      >
                        {allMetrics.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label} ({m.unit})
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label>Group By</Label>
                      <Select
                        value={selectedWidget.groupBy ?? ""}
                        onChange={(e) =>
                          pushSpec({
                            ...spec,
                            widgets: spec.widgets.map((item) =>
                              item.id === selectedWidget.id
                                ? {
                                    ...item,
                                    groupBy: e.target.value
                                      ? (e.target.value as SemanticDimension)
                                      : undefined
                                  }
                                : item
                            )
                          })
                        }
                        className="w-full"
                      >
                        <option value="">(Summary only)</option>
                        {(
                          allMetrics.find((m) => m.id === selectedWidget.metric)
                            ?.allowedDimensions ?? []
                        ).map((dim) => (
                          <option key={dim} value={dim}>
                            {dim}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </>
                )}
              </Card>
            )}
          </aside>
        )}
      </div>

      <Dialog
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        ariaLabel="Version History"
        className="max-w-md p-5 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Version History (Retains Latest 5)</h3>
          <button
            type="button"
            onClick={() => setVersionsOpen(false)}
            aria-label="Close version history"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto space-y-2">
          {versions.map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between rounded-md border border-border p-2.5 text-xs"
            >
              <div>
                <div className="font-semibold font-mono">Version v{v.version}</div>
                <div className="text-muted-foreground">{v.changeSummary}</div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => restoreVersion(v.version)}
              >
                Restore
              </Button>
            </div>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        ariaLabel="Share Dashboard"
        className="max-w-md p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Share Dashboard (Read-Only)</h3>
          <button
            type="button"
            onClick={() => setShareOpen(false)}
            aria-label="Close share dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 text-xs">
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Roles
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(["engineer", "analyst", "manager", "admin"] as const).map((r) => {
                const checked = shares.some(
                  (s) => s.shareType === "role" && s.targetId === r
                );
                return (
                  <label
                    key={r}
                    className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 cursor-pointer hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setShares((prev) => [
                            ...prev,
                            { shareType: "role", targetId: r }
                          ]);
                        } else {
                          setShares((prev) =>
                            prev.filter(
                              (s) => !(s.shareType === "role" && s.targetId === r)
                            )
                          );
                        }
                      }}
                    />
                    <span className="capitalize">{r}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5 pt-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Plants
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(user?.plantIds ?? []).map((pid) => {
                const checked = shares.some(
                  (s) => s.shareType === "plant" && s.targetId === pid
                );
                return (
                  <label
                    key={pid}
                    className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 cursor-pointer hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setShares((prev) => [
                            ...prev,
                            { shareType: "plant", targetId: pid }
                          ]);
                        } else {
                          setShares((prev) =>
                            prev.filter(
                              (s) => !(s.shareType === "plant" && s.targetId === pid)
                            )
                          );
                        }
                      }}
                    />
                    <span>{pid}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <Button onClick={saveShares} className="w-full">
          Save Share Settings
        </Button>
      </Dialog>
    </div>
  );
}
