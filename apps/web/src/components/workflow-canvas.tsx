"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  Bot,
  Cpu,
  GitBranch,
  History,
  Layers,
  Play,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  Wrench,
  X,
  Zap
} from "lucide-react";
import { useAppContext } from "./providers";
import { AuthGate } from "./ui/auth-gate";
import { Badge } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
import { Card } from "./ui/card";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";

export interface CanvasNode {
  id: string;
  type: "trigger" | "condition" | "mcp" | "ai" | "notify" | "queue" | "work_order";
  label: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface WorkflowRecord {
  id: string;
  name: string;
  description: string;
  triggerType: "manual" | "schedule" | "alert" | "connector";
  triggerConfig: Record<string, unknown>;
  definition: { nodes: CanvasNode[]; edges: CanvasEdge[] };
  enabled: boolean;
  currentVersion: number;
}

interface WorkflowVersionItem {
  id: string;
  version: number;
  definition: { nodes: CanvasNode[]; edges: CanvasEdge[] };
  changeSummary: string;
  createdAt: string;
}

interface WorkflowRunItem {
  id: string;
  version: number;
  status: string;
  triggerSource: string;
  triggeredBy: string;
  startedAt: string;
  completedAt?: string | null;
  stepTraces: Array<{
    nodeId: string;
    type?: string;
    label?: string;
    status: string;
    durationMs: number;
    output?: Record<string, unknown>;
    error?: string;
  }>;
  error?: string | null;
}

const NODE_META: Record<
  CanvasNode["type"],
  {
    title: string;
    group: "Logic" | "Intelligence" | "Actions";
    badgeClass: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  trigger: {
    title: "Trigger",
    group: "Logic",
    badgeClass: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    Icon: Zap
  },
  condition: {
    title: "Condition",
    group: "Logic",
    badgeClass: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
    Icon: GitBranch
  },
  mcp: {
    title: "MCP Tool",
    group: "Intelligence",
    badgeClass: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
    Icon: Cpu
  },
  ai: {
    title: "AI Step",
    group: "Intelligence",
    badgeClass: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
    Icon: Bot
  },
  notify: {
    title: "Notify",
    group: "Actions",
    badgeClass: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
    Icon: Bell
  },
  queue: {
    title: "Queue",
    group: "Actions",
    badgeClass: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
    Icon: Layers
  },
  work_order: {
    title: "Work Order",
    group: "Actions",
    badgeClass: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
    Icon: Wrench
  }
};

const NODE_GROUPS: Array<{ label: string; types: Array<CanvasNode["type"]> }> = [
  { label: "Logic", types: ["trigger", "condition"] },
  { label: "Intelligence", types: ["mcp", "ai"] },
  { label: "Actions", types: ["notify", "queue", "work_order"] }
];

const MAX_UNDO = 5;

function withPositions(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.map((n, idx) => ({
    ...n,
    position: n.position ?? { x: 60 + idx * 230, y: 110 }
  }));
}

const SUPPORTED_PROD_MCP_TOOLS = new Set([
  "get_machine",
  "get_machine_status",
  "get_active_alarms",
  "find_part_for_fault",
  "get_parts_inventory",
  "get_work_orders"
]);

export function isWorkflowNodeSupportedInRuntime(
  node: Pick<CanvasNode, "type" | "config">,
  demoEnabled: boolean
): boolean {
  if (demoEnabled) return true;
  if (node.type === "ai") return false;
  if (node.type === "mcp") {
    const tool = String(node.config?.tool ?? "get_active_alarms");
    return SUPPORTED_PROD_MCP_TOOLS.has(tool);
  }
  return true;
}

export function WorkflowCanvas({ workflowId }: { workflowId: string }) {
  const { user, demoEnabled } = useAppContext();
  const [workflow, setWorkflow] = useState<WorkflowRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [history, setHistory] = useState<{
    entries: Array<{ nodes: CanvasNode[]; edges: CanvasEdge[] }>;
    index: number;
  }>({ entries: [], index: -1 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState("{}");
  const [versions, setVersions] = useState<WorkflowVersionItem[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [runs, setRuns] = useState<WorkflowRunItem[]>([]);
  const [sideTab, setSideTab] = useState<"inspector" | "runs">("inspector");
  const [aiPrompt, setAiPrompt] = useState("");
  const [building, setBuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [edgeSource, setEdgeSource] = useState("");
  const [edgeTarget, setEdgeTarget] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragMovedRef = useRef(false);
  const lastCoalesceRef = useRef<string | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const canWrite = user?.role === "analyst" || user?.role === "admin";
  const canExecute =
    user?.role === "engineer" ||
    user?.role === "analyst" ||
    user?.role === "admin";

  const pushGraph = (
    nextNodes: CanvasNode[],
    nextEdges: CanvasEdge[],
    coalesceKey?: string
  ) => {
    setNodes(nextNodes);
    setEdges(nextEdges);
    setDirty(true);
    const shouldReplace =
      Boolean(coalesceKey) && lastCoalesceRef.current === coalesceKey;
    lastCoalesceRef.current = coalesceKey ?? null;
    setHistory((prev) => {
      if (shouldReplace && prev.index >= 0 && prev.entries[prev.index]) {
        const updated = [...prev.entries];
        updated[prev.index] = { nodes: nextNodes, edges: nextEdges };
        return { entries: updated, index: prev.index };
      }
      const nextEntries = [
        ...prev.entries.slice(0, prev.index + 1),
        { nodes: nextNodes, edges: nextEdges }
      ].slice(-MAX_UNDO);
      return { entries: nextEntries, index: nextEntries.length - 1 };
    });
  };

  const loadAll = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [wfRes, runsRes] = await Promise.all([
        fetch(`/api/workflows/${workflowId}`, { cache: "no-store" }),
        fetch(`/api/workflows/${workflowId}/runs`, { cache: "no-store" })
      ]);
      if (wfRes.ok) {
        const data = (await wfRes.json()) as {
          workflow: WorkflowRecord;
          versions: WorkflowVersionItem[];
        };
        const positioned = withPositions(data.workflow.definition?.nodes ?? []);
        const wfEdges = data.workflow.definition?.edges ?? [];
        setWorkflow(data.workflow);
        setName(data.workflow.name);
        setDescription(data.workflow.description);
        setNodes(positioned);
        setEdges(wfEdges);
        setDirty(false);
        setHistory({
          entries: [{ nodes: positioned, edges: wfEdges }],
          index: 0
        });
        setVersions(data.versions ?? []);
        if (positioned[0]) {
          setSelectedNodeId(positioned[0].id);
          setConfigDraft(JSON.stringify(positioned[0].config ?? {}, null, 2));
        }
      } else {
        const err = (await wfRes.json().catch(() => ({}))) as { detail?: string };
        setLoadError(err.detail ?? "Unable to load workflow");
        setWorkflow(null);
        return;
      }
      if (runsRes.ok) {
        const rData = (await runsRes.json()) as { runs: WorkflowRunItem[] };
        setRuns(rData.runs ?? []);
      } else {
        const err = (await runsRes.json().catch(() => ({}))) as { detail?: string };
        setNotice((prev) => prev ?? err.detail ?? "Unable to load workflow run history");
      }
    } catch {
      setLoadError("Failed to load workflow");
      setWorkflow(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) void loadAll();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, user?.userId]);

  if (!user) {
    return (
      <AuthGate
        title="Sign in to view Workflow Canvas"
        description="Visual workflow editing and execution traces require an authenticated Lutic session."
      />
    );
  }

  if (!loading && (loadError || !workflow)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Card role="alert" className="p-6 space-y-4">
          <div className="space-y-1">
            <h1 className="text-base font-bold">Unable to open workflow</h1>
            <p className="text-xs text-muted-foreground">
              {loadError ?? "This workflow could not be found."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadAll()}>
              Retry
            </Button>
            <Link href="/workflows" className={buttonVariants({ size: "sm" })}>
              Back to Workflows
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  const selectNode = (n: CanvasNode, switchToInspector = true) => {
    if (selectedNodeId !== n.id) {
      setSelectedNodeId(n.id);
      setConfigDraft(JSON.stringify(n.config ?? {}, null, 2));
    }
    if (switchToInspector) {
      setSideTab("inspector");
    }
  };

  const handleAddNode = (type: CanvasNode["type"]) => {
    if (!canWrite) return;
    const id = `n-${Date.now().toString(36).slice(-4)}`;
    const last = nodes[nodes.length - 1];
    const nextPos = last?.position
      ? { x: last.position.x + 220, y: last.position.y }
      : { x: 80, y: 120 };
    const newNode: CanvasNode = {
      id,
      type,
      label: NODE_META[type].title,
      config:
        type === "mcp"
          ? { tool: "get_active_alarms", args: { machineId: "mach-l3-filler-01" } }
          : type === "notify"
            ? { topicId: "topic-plant-alerts", severity: "high" }
            : type === "queue"
              ? { queueId: "queue-maintenance-dispatch" }
              : {},
      position: nextPos
    };
    const nextNodes = [...nodes, newNode];
    const nextEdges = last
      ? [...edges, { id: `e-${Date.now().toString(36).slice(-4)}`, source: last.id, target: id }]
      : edges;
    pushGraph(nextNodes, nextEdges);
    setSelectedNodeId(newNode.id);
    setConfigDraft(JSON.stringify(newNode.config ?? {}, null, 2));
    setSideTab("inspector");
  };

  const handleSave = async () => {
    if (!canWrite || !workflow) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/workflows/${workflow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          triggerType: workflow.triggerType,
          triggerConfig: workflow.triggerConfig,
          nodes,
          edges,
          enabled: workflow.enabled,
          changeSummary: "Saved from Visual Workflow Canvas"
        })
      });
      if (res.ok) {
        const data = (await res.json()) as {
          workflow: WorkflowRecord;
          version: number;
          versions: WorkflowVersionItem[];
        };
        setWorkflow(data.workflow);
        setVersions(data.versions ?? []);
        setDirty(false);
        setNotice(`Saved version v${data.version}`);
      } else {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setNotice(err.detail ?? "Save failed");
      }
    } catch {
      setNotice("Save request failed");
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    if (!canExecute || !workflow) return;
    setRunning(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/workflows/${workflow.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { triggeredFrom: "canvas" } })
      });
      const data = (await res.json().catch(() => ({}))) as {
        run?: WorkflowRunItem;
        detail?: string;
      };
      if (res.ok && data.run) {
        setRuns((prev) => [data.run!, ...prev]);
        setSideTab("runs");
        setNotice(`Run ${data.run.id}: ${data.run.status}`);
      } else {
        setNotice(data.detail ?? "Workflow run failed");
      }
    } catch {
      setNotice("Workflow run request failed");
    } finally {
      setRunning(false);
    }
  };

  const handleAiBuild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite || !aiPrompt.trim()) return;
    setBuilding(true);
    setNotice(null);
    try {
      const res = await fetch("/api/workflows/ai-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt.trim() })
      });
      if (res.ok) {
        const data = (await res.json()) as {
          workflow: {
            name: string;
            description?: string;
            triggerType?: WorkflowRecord["triggerType"];
            triggerConfig?: Record<string, unknown>;
            nodes: CanvasNode[];
            edges: CanvasEdge[];
          };
        };
        const nextNodes = withPositions(data.workflow.nodes ?? []);
        const nextEdges = data.workflow.edges ?? [];
        setWorkflow((prev) =>
          prev
            ? {
                ...prev,
                triggerType: data.workflow.triggerType ?? prev.triggerType,
                triggerConfig: data.workflow.triggerConfig ?? prev.triggerConfig
              }
            : prev
        );
        pushGraph(nextNodes, nextEdges);
        if (nextNodes[0]) {
          setSelectedNodeId(nextNodes[0].id);
          setConfigDraft(JSON.stringify(nextNodes[0].config ?? {}, null, 2));
          setSideTab("inspector");
        }
        setAiPrompt("");
        setNotice("Generated draft workflow graph on canvas — click Save Version to persist.");
      } else {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setNotice(err.detail ?? "Workflow draft generation failed");
      }
    } catch {
      setNotice("Workflow draft request failed");
    } finally {
      setBuilding(false);
    }
  };

  const restoreVersion = async (ver: number) => {
    if (!canWrite || !workflow) return;
    try {
      const res = await fetch(`/api/workflows/${workflow.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: ver })
      });
      if (res.ok) {
        const data = (await res.json()) as {
          workflow: WorkflowRecord;
          version: number;
          versions: WorkflowVersionItem[];
        };
        const positioned = withPositions(data.workflow.definition.nodes ?? []);
        const wfEdges = data.workflow.definition.edges ?? [];
        setWorkflow(data.workflow);
        setName(data.workflow.name);
        setDescription(data.workflow.description);
        pushGraph(positioned, wfEdges);
        setDirty(false);
        if (positioned[0]) {
          setSelectedNodeId(positioned[0].id);
          setConfigDraft(JSON.stringify(positioned[0].config ?? {}, null, 2));
        }
        setVersions(data.versions ?? []);
        setVersionsOpen(false);
        setNotice(`Restored v${ver} as v${data.version}`);
      } else {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setNotice(err.detail ?? "Failed to restore version");
      }
    } catch {
      setNotice("Version restore request failed");
    }
  };

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const canvasWidth = Math.max(
    920,
    ...nodes.map((n) => (n.position?.x ?? 80) + 240)
  );
  const canvasHeight = Math.max(
    440,
    ...nodes.map((n) => (n.position?.y ?? 110) + 140)
  );

  const selectedNodeEdges = selectedNode
    ? edges.filter(
        (e) => e.source === selectedNode.id || e.target === selectedNode.id
      )
    : [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 space-y-4">
      <Card className="p-3.5 sm:p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link
              href="/workflows"
              className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Workflows</span>
            </Link>
            <Badge variant="secondary" className="font-mono">
              Workflow Canvas · v{workflow?.currentVersion ?? 1}
            </Badge>
            {dirty && <Badge variant="default">Unsaved changes</Badge>}
            <span className="text-muted-foreground font-mono tabular-nums">
              {nodes.length} nodes · {edges.length} edges
            </span>
          </div>
          {canWrite ? (
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              aria-label="Workflow name"
              className="text-lg font-bold bg-transparent border-b border-transparent focus:border-primary outline-none w-full max-w-xl"
            />
          ) : (
            <h1 className="text-lg font-bold min-w-0 break-words">{name || "Workflow Canvas"}</h1>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {canWrite && (
            <>
              <div className="inline-flex items-center rounded-md border border-border bg-background">
                <button
                  type="button"
                  disabled={history.index <= 0}
                  onClick={() => {
                    const idx = history.index - 1;
                    const target = history.entries[idx];
                    if (!target) return;
                    lastCoalesceRef.current = null;
                    setHistory((prev) => ({ ...prev, index: idx }));
                    setNodes(target.nodes);
                    setEdges(target.edges);
                  }}
                  className="p-2 disabled:opacity-40 hover:bg-muted rounded-l-md border-r border-border"
                  title="Undo"
                  aria-label="Undo workflow edit"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={history.index >= history.entries.length - 1}
                  onClick={() => {
                    const idx = history.index + 1;
                    const target = history.entries[idx];
                    if (!target) return;
                    lastCoalesceRef.current = null;
                    setHistory((prev) => ({ ...prev, index: idx }));
                    setNodes(target.nodes);
                    setEdges(target.edges);
                  }}
                  className="p-2 disabled:opacity-40 hover:bg-muted rounded-r-md"
                  title="Redo"
                  aria-label="Redo workflow edit"
                >
                  <Redo2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <Button variant="outline" size="sm" onClick={() => setVersionsOpen(true)}>
                <History className="h-3.5 w-3.5" />
                <span>Versions ({versions.length}/5)</span>
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving || !workflow}>
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? "Saving..." : "Save Version"}</span>
              </Button>
            </>
          )}

          {canExecute && (
            <Button
              size="sm"
              onClick={handleRun}
              disabled={running || !workflow}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{running ? "Running..." : "Run Now"}</span>
            </Button>
          )}
        </div>
      </Card>

      {notice && (
        <div className="rounded-md border border-border bg-muted/60 px-3.5 py-2 text-xs font-medium flex justify-between items-center gap-2 min-w-0">
          <span className="min-w-0 break-words">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss workflow notice"
            className="shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!demoEnabled && nodes.some((n) => !isWorkflowNodeSupportedInRuntime(n, demoEnabled)) && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-900 dark:text-amber-200">
          This workflow contains an AI Step or an unsupported MCP Tool. AI Step nodes and MCP Tool nodes outside{" "}
          <code className="font-mono">get_machine</code>,{" "}
          <code className="font-mono">get_machine_status</code>,{" "}
          <code className="font-mono">get_active_alarms</code>,{" "}
          <code className="font-mono">find_part_for_fault</code>,{" "}
          <code className="font-mono">get_parts_inventory</code>, and{" "}
          <code className="font-mono">get_work_orders</code> are unavailable in production.
        </div>
      )}

      {!demoEnabled &&
        nodes.some((n) => {
          if (n.type !== "mcp") return false;
          const tool = String(n.config?.tool ?? "");
          if (tool !== "get_machine" && tool !== "get_machine_status") return false;
          const args = n.config?.args as Record<string, unknown> | undefined;
          return typeof args?.machineId !== "string" || !args.machineId.trim();
        }) && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-900 dark:text-amber-200">
            MCP steps using <code className="font-mono">get_machine</code> or{" "}
            <code className="font-mono">get_machine_status</code> require{" "}
            <code className="font-mono">config.args.machineId</code> (or runtime trigger{" "}
            <code className="font-mono">input.machineId</code>) in production.
          </div>
        )}

      {canWrite && (
        <Card className="p-3">
          <form onSubmit={handleAiBuild} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary shrink-0 px-1">
              <Sparkles className="h-4 w-4" />
              <span>Rule-Based Workflow Builder (Keyword Draft)</span>
            </div>
            <Input
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder='e.g. "When mach-l1-cnc-01 temperature exceeds 80C, check alarms and send alert"'
              aria-label="Workflow draft prompt"
              className="flex-1 min-w-0"
            />
            <Button type="submit" disabled={building || !aiPrompt.trim()} className="shrink-0">
              {building ? "Building..." : "Generate Graph"}
            </Button>
          </form>
        </Card>
      )}

      {loading ? (
        <div className="h-[440px] rounded-lg border border-border bg-muted animate-pulse" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2 space-y-3">
            {canWrite && (
              <Card className="p-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
                {NODE_GROUPS.map((grp) => (
                  <div key={grp.label} className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {grp.label}:
                    </span>
                    {grp.types.map((t) => {
                      const aiUnavailable = t === "ai" && !demoEnabled;
                      return (
                        <Button
                          key={t}
                          variant="outline"
                          size="sm"
                          disabled={aiUnavailable}
                          title={aiUnavailable ? "Workflow AI step executor is unavailable outside demo mode" : undefined}
                          onClick={() => handleAddNode(t)}
                          className="h-7 px-2 text-[11px] shrink-0"
                        >
                          <Plus className="h-3 w-3" />
                          <span>{aiUnavailable ? "AI Step (Demo only)" : NODE_META[t].title}</span>
                        </Button>
                      );
                    })}
                  </div>
                ))}
              </Card>
            )}

            <div
              className="relative min-h-[440px] w-full max-w-full rounded-lg border border-border bg-muted/20 overflow-auto shadow-sm"
              style={{
                backgroundImage:
                  "radial-gradient(circle, rgba(120,120,120,0.2) 1px, transparent 1px)",
                backgroundSize: "20px 20px"
              }}
              onMouseMove={(e) => {
                if (!draggingId || !canWrite) return;
                dragMovedRef.current = true;
                const rect = e.currentTarget.getBoundingClientRect();
                const x = Math.max(12, Math.round(e.clientX - rect.left + e.currentTarget.scrollLeft - 85));
                const y = Math.max(12, Math.round(e.clientY - rect.top + e.currentTarget.scrollTop - 28));
                setNodes((prev) =>
                  prev.map((n) => (n.id === draggingId ? { ...n, position: { x, y } } : n))
                );
              }}
              onMouseUp={() => {
                if (draggingId && dragMovedRef.current) {
                  pushGraph(nodesRef.current, edgesRef.current);
                }
                dragMovedRef.current = false;
                setDraggingId(null);
              }}
              onMouseLeave={() => {
                if (draggingId && dragMovedRef.current) {
                  pushGraph(nodesRef.current, edgesRef.current);
                }
                dragMovedRef.current = false;
                setDraggingId(null);
              }}
            >
              <svg
                width={canvasWidth}
                height={canvasHeight}
                className="absolute top-0 left-0 pointer-events-none"
              >
                <defs>
                  <marker
                    id="lutic-arrow"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L8,4 L0,8 Z" fill="hsl(var(--primary))" />
                  </marker>
                </defs>
                {edges.map((edge) => {
                  const src = nodeMap.get(edge.source);
                  const tgt = nodeMap.get(edge.target);
                  if (!src || !tgt) return null;
                  const sx = (src.position?.x ?? 80) + 176;
                  const sy = (src.position?.y ?? 110) + 34;
                  const tx = tgt.position?.x ?? 300;
                  const ty = (tgt.position?.y ?? 110) + 34;
                  const dx = Math.max(40, Math.abs(tx - sx) * 0.5);
                  const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
                  return (
                    <path
                      key={edge.id}
                      d={d}
                      fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth="2"
                      markerEnd="url(#lutic-arrow)"
                    />
                  );
                })}
              </svg>

              <div
                className="relative"
                style={{ width: canvasWidth, height: canvasHeight }}
              >
                {nodes.map((node) => {
                  const meta = NODE_META[node.type] ?? NODE_META.mcp;
                  const Icon = meta.Icon;
                  const pos = node.position ?? { x: 80, y: 110 };
                  const active = selectedNodeId === node.id;
                  return (
                    <div
                      key={node.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Select node ${node.label} (${node.id})`}
                      aria-pressed={active}
                      onMouseDown={() => {
                        dragMovedRef.current = false;
                        selectNode(node, false);
                        if (canWrite) setDraggingId(node.id);
                      }}
                      onClick={() => {
                        if (!dragMovedRef.current) selectNode(node, true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectNode(node, true);
                        }
                      }}
                      style={{ left: pos.x, top: pos.y }}
                      className={`absolute w-44 cursor-pointer rounded-lg border bg-card p-2.5 shadow-sm select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                        active ? "border-primary ring-2 ring-primary/25" : "border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${meta.badgeClass}`}
                        >
                          <Icon className="h-3 w-3" />
                          <span>{meta.title}</span>
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {node.id}
                        </span>
                      </div>
                      <div className="text-xs font-semibold truncate">{node.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {canWrite && nodes.length >= 2 && (
              <Card className="p-3 flex flex-wrap items-center gap-2 text-xs min-w-0">
                <span className="font-semibold">Connect Edge:</span>
                <Select
                  aria-label="Edge source node"
                  value={edgeSource}
                  onChange={(e) => setEdgeSource(e.target.value)}
                  className="h-8 min-w-0 max-w-full sm:max-w-[220px]"
                >
                  <option value="">Source node</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.id} ({n.label})
                    </option>
                  ))}
                </Select>
                <span className="text-muted-foreground">to</span>
                <Select
                  aria-label="Edge target node"
                  value={edgeTarget}
                  onChange={(e) => setEdgeTarget(e.target.value)}
                  className="h-8 min-w-0 max-w-full sm:max-w-[220px]"
                >
                  <option value="">Target node</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.id} ({n.label})
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  onClick={() => {
                    if (!edgeSource || !edgeTarget) return;
                    if (edgeSource === edgeTarget) {
                      setNotice("Cannot connect a node to itself");
                      return;
                    }
                    if (edges.some((e) => e.source === edgeSource && e.target === edgeTarget)) {
                      setNotice("Edge already exists between these nodes");
                      return;
                    }
                    pushGraph(nodes, [
                      ...edges,
                      { id: `e-${Date.now().toString(36).slice(-4)}`, source: edgeSource, target: edgeTarget }
                    ]);
                    setEdgeSource("");
                    setEdgeTarget("");
                  }}
                >
                  Add Edge
                </Button>
              </Card>
            )}
          </div>

          <aside className="min-w-0 space-y-3">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger
                active={sideTab === "inspector"}
                onClick={() => setSideTab("inspector")}
              >
                Inspector
              </TabsTrigger>
              <TabsTrigger
                active={sideTab === "runs"}
                onClick={() => setSideTab("runs")}
              >
                Runs ({runs.length})
              </TabsTrigger>
            </TabsList>

            {sideTab === "inspector" ? (
              selectedNode ? (
                <Card className="p-4 space-y-3 min-w-0">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <h2 className="text-sm font-semibold truncate">Node Inspector ({selectedNode.id})</h2>
                    {canWrite && nodes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const nextNodes = nodes.filter((n) => n.id !== selectedNode.id);
                          const nextEdges = edges.filter(
                            (e) => e.source !== selectedNode.id && e.target !== selectedNode.id
                          );
                          pushGraph(nextNodes, nextEdges);
                          setSelectedNodeId(nextNodes[0]?.id ?? null);
                          if (nextNodes[0]) {
                            setConfigDraft(JSON.stringify(nextNodes[0].config ?? {}, null, 2));
                          }
                        }}
                        className="rounded p-1 text-destructive hover:bg-muted shrink-0"
                        title="Delete node"
                        aria-label={`Delete node ${selectedNode.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="workflow-node-label">Label</Label>
                    <Input
                      id="workflow-node-label"
                      disabled={!canWrite}
                      value={selectedNode.label}
                      className="min-w-0"
                      onChange={(e) => {
                        const next = nodes.map((n) =>
                          n.id === selectedNode.id ? { ...n, label: e.target.value } : n
                        );
                        pushGraph(next, edges, `label:${selectedNode.id}`);
                      }}
                      onBlur={() => {
                        lastCoalesceRef.current = null;
                      }}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="workflow-node-type">Node Type</Label>
                    <Select
                      id="workflow-node-type"
                      disabled={!canWrite}
                      value={selectedNode.type}
                      onChange={(e) => {
                        const next = nodes.map((n) =>
                          n.id === selectedNode.id
                            ? { ...n, type: e.target.value as CanvasNode["type"] }
                            : n
                        );
                        pushGraph(next, edges);
                      }}
                      className="w-full min-w-0"
                    >
                      {(Object.keys(NODE_META) as Array<CanvasNode["type"]>).map((t) => {
                        const aiUnavailable = t === "ai" && !demoEnabled;
                        return (
                          <option key={t} value={t} disabled={aiUnavailable}>
                            {aiUnavailable ? "AI Step (Demo only)" : NODE_META[t].title}
                          </option>
                        );
                      })}
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="workflow-node-config">Config (JSON)</Label>
                    <Textarea
                      id="workflow-node-config"
                      rows={5}
                      disabled={!canWrite}
                      value={configDraft}
                      onChange={(e) => setConfigDraft(e.target.value)}
                      className="font-mono w-full min-w-0"
                    />
                    {canWrite && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          try {
                            const parsed = JSON.parse(configDraft) as Record<string, unknown>;
                            const next = nodes.map((n) =>
                              n.id === selectedNode.id ? { ...n, config: parsed } : n
                            );
                            pushGraph(next, edges);
                            setNotice(`Applied config to ${selectedNode.id}`);
                          } catch {
                            setNotice("Invalid JSON in node config");
                          }
                        }}
                      >
                        Apply Config
                      </Button>
                    )}
                  </div>

                  <div className="space-y-1.5 border-t border-border pt-2.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Connections ({selectedNodeEdges.length})
                    </div>
                    {selectedNodeEdges.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No connected edges.</div>
                    ) : (
                      <div className="space-y-1">
                        {selectedNodeEdges.map((edge) => (
                          <div
                            key={edge.id}
                            className="flex items-center justify-between gap-2 rounded border border-border bg-muted/40 px-2 py-1 text-[11px] font-mono min-w-0"
                          >
                            <span className="truncate">
                              {edge.source} → {edge.target}
                            </span>
                            {canWrite && (
                              <button
                                type="button"
                                onClick={() => {
                                  pushGraph(
                                    nodes,
                                    edges.filter((e) => e.id !== edge.id)
                                  );
                                }}
                                aria-label={`Remove edge ${edge.source} to ${edge.target}`}
                                className="inline-flex items-center justify-center min-h-6 min-w-6 rounded p-1 text-destructive hover:bg-destructive/10 hover:opacity-80 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              ) : (
                <Card className="p-4 text-xs text-muted-foreground">
                  Select a node on the canvas to inspect or edit its configuration.
                </Card>
              )
            ) : (
              <Card className="p-4 space-y-3 min-w-0">
                <h2 className="text-sm font-semibold">Execution Trace History</h2>
                <div className="max-h-96 overflow-y-auto space-y-2.5">
                  {runs.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No executions recorded yet.</div>
                  ) : (
                    runs.map((run) => (
                      <div key={run.id} className="rounded-md border border-border p-2.5 text-xs space-y-1.5 min-w-0">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="font-mono font-semibold truncate">{run.id}</span>
                          <Badge
                            variant={run.status === "succeeded" ? "success" : "destructive"}
                            className="uppercase text-[10px] shrink-0"
                          >
                            {run.status}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-muted-foreground tabular-nums">
                          v{run.version} · {run.triggerSource} ·{" "}
                          {new Date(run.startedAt).toLocaleString()}
                        </div>
                        {run.stepTraces?.length > 0 && (
                          <div className="space-y-1 pt-1 border-t border-border/50">
                            {run.stepTraces.map((st, idx) => (
                              <div key={idx} className="flex items-center justify-between gap-2 text-[11px] min-w-0">
                                <span className="truncate">
                                  <code className="font-mono">{st.nodeId}</code> {st.label ?? st.type}
                                </span>
                                <span className="font-mono tabular-nums text-muted-foreground shrink-0">
                                  {st.status} ({st.durationMs}ms)
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </Card>
            )}
          </aside>
        </div>
      )}

      <Dialog
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        ariaLabel="Workflow Version History"
        className="max-w-md p-5 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Workflow Version History (Max 5)</h3>
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
              className="flex items-center justify-between gap-2 rounded-md border border-border p-2.5 text-xs min-w-0"
            >
              <div className="min-w-0">
                <div className="font-semibold font-mono">Version v{v.version}</div>
                <div className="text-muted-foreground break-words">{v.changeSummary}</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => restoreVersion(v.version)} className="shrink-0">
                Restore
              </Button>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
