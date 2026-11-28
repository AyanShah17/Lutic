import { z } from "zod";
import type { SandboxServiceId } from "./sandbox-services";

export const A2UIKpiComponentSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal("kpi"),
  title: z.string().min(1).max(120),
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        value: z.string().min(1).max(64),
        delta: z.string().max(48).optional(),
        tone: z.enum(["default", "success", "warning", "danger"]).optional()
      })
    )
    .min(1)
    .max(6)
});

export const A2UIChartComponentSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal("chart"),
  title: z.string().min(1).max(120),
  chartType: z.enum(["bar", "line"]),
  unit: z.string().max(24).optional(),
  series: z
    .array(
      z.object({
        label: z.string().min(1).max(48),
        value: z.number().finite()
      })
    )
    .min(1)
    .max(16)
});

export const A2UITableComponentSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal("table"),
  title: z.string().min(1).max(120),
  columns: z.array(z.string().min(1).max(48)).min(1).max(6),
  rows: z.array(z.array(z.string().max(160)).min(1).max(6)).max(15)
});

const SafeRelativeHrefSchema = z
  .string()
  .max(160)
  .refine((v) => v.startsWith("/") && !v.startsWith("//"), {
    message: "Only relative app paths are permitted"
  });

export const A2UIStatusListComponentSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal("status_list"),
  title: z.string().min(1).max(120),
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        detail: z.string().max(180).optional(),
        status: z.enum(["ok", "warn", "error", "idle"]),
        href: SafeRelativeHrefSchema.optional()
      })
    )
    .min(1)
    .max(12)
});

export const A2UIActionBarComponentSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal("action_bar"),
  title: z.string().min(1).max(120),
  actions: z
    .array(
      z.object({
        label: z.string().min(1).max(64),
        href: SafeRelativeHrefSchema.optional(),
        aiPrompt: z.string().max(400).optional(),
        serviceId: z.string().max(48).optional()
      })
    )
    .min(1)
    .max(6)
});

export const A2UIFormComponentSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal("form"),
  title: z.string().min(1).max(120),
  submitLabel: z.string().min(1).max(64).default("Run Action"),
  aiPromptTemplate: z.string().min(1).max(500),
  fields: z
    .array(
      z.object({
        name: z.string().min(1).max(48),
        label: z.string().min(1).max(80),
        placeholder: z.string().max(120).optional(),
        defaultValue: z.string().max(200).optional(),
        kind: z.enum(["text", "select"]).default("text"),
        options: z.array(z.string().max(80)).max(12).optional()
      })
    )
    .min(1)
    .max(6)
});

export const A2UIComponentSchema = z.discriminatedUnion("type", [
  A2UIKpiComponentSchema,
  A2UIChartComponentSchema,
  A2UITableComponentSchema,
  A2UIStatusListComponentSchema,
  A2UIActionBarComponentSchema,
  A2UIFormComponentSchema
]);

export const A2UISpecSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  subtitle: z.string().max(240).default(""),
  prompt: z.string().min(1).max(500),
  createdAt: z.string().min(1).max(64),
  layout: z.enum(["grid", "stack"]).default("grid"),
  components: z.array(A2UIComponentSchema).min(1).max(8)
});

export type A2UIComponent = z.infer<typeof A2UIComponentSchema>;
export type A2UISpec = z.infer<typeof A2UISpecSchema>;

export interface A2UIBuildContext {
  prompt: string;
  activeServiceIds: SandboxServiceId[];
  machines?: Array<{ id: string; name: string; status: string }>;
  alarms?: Array<{ id: string; code: string; machineId: string; message: string; severity: string }>;
  workflows?: Array<{ id: string; name: string; enabled: boolean; triggerType: string }>;
  issues?: Array<{ identifier: string; title: string; status: string; priority: string }>;
  connectors?: Array<{ id: string; name: string; status: string; category: string }>;
  metrics?: {
    oee?: number;
    availability?: number;
    throughput?: number;
    scrapRate?: number;
  };
}

const SERVICE_GOAL_KEYWORDS: Array<{ id: SandboxServiceId; keywords: string[] }> = [
  { id: "board", keywords: ["board", "task", "issue", "ticket", "triage", "sprint", "work order", "kanban"] },
  { id: "dashboards", keywords: ["dashboard", "kpi", "metric", "chart", "analytics", "oee", "report", "viz"] },
  { id: "workflows", keywords: ["workflow", "pipeline", "automation", "dag", "trigger", "schedule", "flow", "n8n"] },
  { id: "monitoring", keywords: ["monitor", "alert", "alarm", "anomaly", "health", "sla", "incident", "threshold"] },
  { id: "machines", keywords: ["machine", "fleet", "cnc", "plant", "line", "asset", "telemetry", "sensor", "equipment"] },
  { id: "connectors", keywords: ["connector", "integration", "api", "sync", "webhook", "slack", "github", "sap", "erp"] },
  { id: "notifications", keywords: ["notify", "notification", "email", "escalation", "digest", "broadcast"] },
  { id: "queues", keywords: ["queue", "dispatch", "worker", "job", "retry", "backlog", "dead-letter"] }
];

export function recommendServicesForGoal(goal: string, maxCount = 3): SandboxServiceId[] {
  const lower = goal.toLowerCase();
  const scored = SERVICE_GOAL_KEYWORDS.map((entry, idx) => {
    let hits = 0;
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) hits += 1;
    }
    return { id: entry.id, hits, idx };
  });

  const matched = scored
    .filter((s) => s.hits > 0)
    .sort((a, b) => (b.hits !== a.hits ? b.hits - a.hits : a.idx - b.idx))
    .map((s) => s.id);

  const fallbackOrder: SandboxServiceId[] = ["dashboards", "workflows", "board", "connectors", "monitoring", "machines"];
  for (const id of fallbackOrder) {
    if (matched.length >= maxCount) break;
    if (!matched.includes(id)) matched.push(id);
  }
  return matched.slice(0, Math.max(1, maxCount));
}

function stableSlug(prompt: string): string {
  const clean = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
  return `a2ui-${clean || "view"}`;
}

export function buildA2UIFromPrompt(ctx: A2UIBuildContext): A2UISpec {
  const prompt = ctx.prompt.trim();
  const lower = prompt.toLowerCase();
  const activeSet = new Set<SandboxServiceId>(ctx.activeServiceIds);
  const machines = ctx.machines ?? [];
  const alarms = ctx.alarms ?? [];
  const workflows = ctx.workflows ?? [];
  const issues = ctx.issues ?? [];
  const connectors = ctx.connectors ?? [];

  const runningMachines = machines.filter((m) => m.status === "running").length;
  const faultMachines = machines.filter((m) => m.status === "fault").length;
  const connectedCount = connectors.filter((c) => c.status === "connected").length;
  const enabledWorkflows = workflows.filter((w) => w.enabled).length;
  const openIssues = issues.filter((i) => i.status !== "done").length;

  const components: A2UIComponent[] = [];

  if (/\b(form|intake|request|submit|create|triage form)\b/.test(lower)) {
    components.push({
      id: "cmp-form",
      type: "form",
      title: "Guided Action Intake",
      submitLabel: "Send to Assistant",
      aiPromptTemplate: `Handle request (${prompt.slice(0, 80)}): priority={{priority}}, summary={{summary}}`,
      fields: [
        {
          name: "priority",
          label: "Priority",
          kind: "select",
          defaultValue: "high",
          options: ["urgent", "high", "medium", "low"]
        },
        {
          name: "summary",
          label: "Request Summary",
          placeholder: "Describe what needs to happen...",
          kind: "text"
        }
      ]
    });
  }

  if (/\b(chart|trend|oee|kpi|analytics|metric|throughput|performance)\b/.test(lower)) {
    const oee = Number((ctx.metrics?.oee ?? 86.4).toFixed(1));
    const avail = Number((ctx.metrics?.availability ?? 94.2).toFixed(1));
    const throughput = Math.round(ctx.metrics?.throughput ?? 1420);
    components.push({
      id: "cmp-kpi-analytics",
      type: "kpi",
      title: "Live Performance Snapshot",
      items: [
        { label: "OEE", value: `${oee}%`, delta: "7d avg", tone: oee >= 85 ? "success" : "warning" },
        { label: "Availability", value: `${avail}%`, delta: "target 95%", tone: avail >= 92 ? "success" : "warning" },
        { label: "Throughput", value: `${throughput}`, delta: "units/shift", tone: "default" }
      ]
    });
    components.push({
      id: "cmp-chart-analytics",
      type: "chart",
      title: "Shift Efficiency & Throughput Trend",
      chartType: /\b(line|trend)\b/.test(lower) ? "line" : "bar",
      unit: "%",
      series: [
        { label: "Shift 1", value: Number(Math.max(40, oee - 4).toFixed(1)) },
        { label: "Shift 2", value: Number(Math.max(40, oee - 1.5).toFixed(1)) },
        { label: "Shift 3", value: oee },
        { label: "Current", value: Number(Math.min(100, avail).toFixed(1)) }
      ]
    });
  }

  if (/\b(fault|alarm|alert|machine|line|health|monitor)\b/.test(lower) && (activeSet.has("machines") || activeSet.has("monitoring") || activeSet.size === 0)) {
    components.push({
      id: "cmp-kpi-ops",
      type: "kpi",
      title: "Equipment & Alert Health",
      items: [
        { label: "Fleet Running", value: `${runningMachines}/${machines.length}`, tone: "success" },
        { label: "Faulted Assets", value: `${faultMachines}`, tone: faultMachines > 0 ? "danger" : "success" },
        { label: "Active Alarms", value: `${alarms.length}`, tone: alarms.length > 0 ? "warning" : "success" }
      ]
    });
    if (alarms.length > 0 || machines.length > 0) {
      components.push({
        id: "cmp-table-ops",
        type: "table",
        title: alarms.length > 0 ? "Active Alarms" : "Tracked Assets",
        columns: alarms.length > 0 ? ["Code", "Asset", "Severity", "Message"] : ["Asset", "Name", "Status"],
        rows:
          alarms.length > 0
            ? alarms.slice(0, 6).map((a) => [a.code, a.machineId, a.severity, a.message.slice(0, 90)])
            : machines.slice(0, 6).map((m) => [m.id, m.name, m.status])
      });
    }
  }

  if (/\b(workflow|pipeline|automation|dag|flow)\b/.test(lower) && (activeSet.has("workflows") || activeSet.size === 0)) {
    components.push({
      id: "cmp-status-workflows",
      type: "status_list",
      title: "Automation Pipelines",
      items:
        workflows.length > 0
          ? workflows.slice(0, 6).map((w) => ({
              label: w.name,
              detail: `Trigger: ${w.triggerType}`,
              status: w.enabled ? ("ok" as const) : ("idle" as const),
              href: `/workflows/${w.id}`
            }))
          : [{ label: "No workflows created yet", detail: "Open AI Canvas to build a pipeline", status: "idle", href: "/workflows" }]
    });
  }

  if (/\b(connector|integration|sync|app|oauth)\b/.test(lower) && (activeSet.has("connectors") || activeSet.size === 0)) {
    components.push({
      id: "cmp-status-connectors",
      type: "status_list",
      title: "Connected Integrations",
      items:
        connectors.length > 0
          ? connectors.slice(0, 6).map((c) => ({
              label: c.name,
              detail: c.category.toUpperCase(),
              status: c.status === "connected" ? ("ok" as const) : c.status === "error" ? ("error" as const) : ("warn" as const),
              href: "/connectors"
            }))
          : [{ label: "No external integrations yet", detail: "Add up to 5 on Free plan", status: "idle", href: "/connectors" }]
    });
  }

  if (/\b(board|issue|task|ticket|work|triage)\b/.test(lower) && (activeSet.has("board") || activeSet.size === 0)) {
    components.push({
      id: "cmp-table-board",
      type: "table",
      title: "Active Board Items",
      columns: ["Key", "Title", "Status", "Priority"],
      rows:
        issues.length > 0
          ? issues.slice(0, 6).map((i) => [i.identifier, i.title.slice(0, 72), i.status, i.priority])
          : [["LUT-101", "Add first operational task", "todo", "medium"]]
    });
  }

  if (components.length === 0) {
    const kpiItems: Array<{ label: string; value: string; delta?: string; tone?: "default" | "success" | "warning" | "danger" }> = [
      { label: "Active Services", value: `${activeSet.size}`, tone: "default" }
    ];
    if (activeSet.has("board") || openIssues > 0) {
      kpiItems.push({ label: "Open Tasks", value: `${openIssues}`, tone: openIssues > 0 ? "warning" : "success" });
    }
    if (activeSet.has("workflows") || workflows.length > 0) {
      kpiItems.push({ label: "Live Pipelines", value: `${enabledWorkflows}`, tone: "success" });
    }
    if (activeSet.has("connectors") || connectors.length > 0) {
      kpiItems.push({ label: "Connected Apps", value: `${connectedCount}`, tone: "default" });
    }
    if (activeSet.has("machines") || machines.length > 0) {
      kpiItems.push({ label: "Fleet Running", value: `${runningMachines}/${machines.length}`, tone: faultMachines > 0 ? "warning" : "success" });
    }
    components.push({
      id: "cmp-kpi-summary",
      type: "kpi",
      title: "Workspace Summary",
      items: kpiItems.slice(0, 4)
    });

    const listItems: Array<{ label: string; detail?: string; status: "ok" | "warn" | "error" | "idle"; href?: string }> = [];
    for (const i of issues.slice(0, 2)) {
      listItems.push({ label: `${i.identifier}: ${i.title}`, detail: `${i.status} · ${i.priority}`, status: i.priority === "urgent" ? "warn" : "ok", href: "/board" });
    }
    for (const w of workflows.slice(0, 2)) {
      listItems.push({ label: w.name, detail: `Pipeline (${w.triggerType})`, status: w.enabled ? "ok" : "idle", href: `/workflows/${w.id}` });
    }
    for (const a of alarms.slice(0, 2)) {
      listItems.push({ label: `${a.code} on ${a.machineId}`, detail: a.message, status: "error", href: `/m/${a.machineId}` });
    }
    if (listItems.length === 0) {
      listItems.push({ label: "Workspace ready", detail: "Ask Assistant or open any enabled service", status: "ok" });
    }
    components.push({
      id: "cmp-status-overview",
      type: "status_list",
      title: "Live Items",
      items: listItems
    });
  }

  const actions: Array<{ label: string; href?: string; aiPrompt?: string }> = [];
  if (activeSet.has("board")) actions.push({ label: "Open AI Board", href: "/board" });
  if (activeSet.has("dashboards")) actions.push({ label: "Open Dashboards", href: "/dashboards" });
  if (activeSet.has("workflows")) actions.push({ label: "Open Workflows", href: "/workflows" });
  if (activeSet.has("connectors")) actions.push({ label: "Open Connectors", href: "/connectors" });
  actions.push({ label: "Summarize Workspace", aiPrompt: `Summarize status for: ${prompt.slice(0, 120)}` });

  components.push({
    id: "cmp-actions",
    type: "action_bar",
    title: "Quick Actions",
    actions: actions.slice(0, 4)
  });

  const cleanTitle = prompt.length > 56 ? `${prompt.slice(0, 53)}...` : prompt;
  return A2UISpecSchema.parse({
    id: `${stableSlug(prompt)}-${Math.random().toString(36).slice(2, 6)}`,
    title: cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1),
    subtitle: "Generated from live workspace state",
    prompt,
    createdAt: new Date().toISOString(),
    layout: "grid",
    components: components.slice(0, 8)
  });
}
