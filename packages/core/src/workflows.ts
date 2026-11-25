import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { LuticDatabase } from "./db/client";
import {
  alarms,
  assets,
  inventory,
  machineStatus,
  notifications,
  parts,
  workOrders,
  workflowRuns,
  workflowVersions,
  workflows
} from "./db/schema";
import {
  enqueueQueueMessage,
  publishToTopic,
  registerTopicWorkflowExecutor
} from "./messaging";
import { registerTriggerWorkflowExecutor } from "./connector-hub";
import { isDemoMode, registerRuntimeHooks, shouldSkipAutoRuntime } from "./runtime";

export const WorkflowNodeTypeSchema = z.enum([
  "trigger",
  "condition",
  "mcp",
  "ai",
  "notify",
  "queue",
  "work_order"
]);

export type WorkflowNodeType = z.infer<typeof WorkflowNodeTypeSchema>;

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  type: WorkflowNodeTypeSchema.default("mcp"),
  label: z.string().min(1).default("Step"),
  config: z.record(z.string(), z.unknown()).default({}),
  position: z
    .object({
      x: z.number(),
      y: z.number()
    })
    .optional()
});

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional()
});

export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowDefinitionSchema = z.object({
  nodes: z.array(WorkflowNodeSchema).min(1),
  edges: z.array(WorkflowEdgeSchema).default([])
});

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export interface WorkflowStepTrace {
  nodeId: string;
  type: string;
  label: string;
  status: "succeeded" | "skipped" | "failed";
  durationMs: number;
  attempts?: number;
  checkpointedAt?: string;
  output?: Record<string, unknown>;
  error?: string;
}

export type WorkflowAiExecutor = (params: {
  tenantId: string;
  workflowId: string;
  runId: string;
  nodeId: string;
  label: string;
  prompt: string;
  context: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

let registeredWorkflowAiExecutor: WorkflowAiExecutor | null = null;

export function registerWorkflowAiExecutor(executor: WorkflowAiExecutor | null): void {
  registeredWorkflowAiExecutor = executor;
}

export function hasWorkflowAiExecutor(): boolean {
  return registeredWorkflowAiExecutor !== null;
}

export interface BuiltWorkflowDraft {
  name: string;
  description: string;
  triggerType: "manual" | "schedule" | "alert" | "connector";
  triggerConfig: Record<string, unknown>;
  definition: WorkflowDefinition;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export function buildWorkflowFromPrompt(prompt: string): BuiltWorkflowDraft {
  const clean = prompt.trim() || "Automated Plant Operations Workflow";
  const lower = clean.toLowerCase();

  const machineMatch = clean.match(/\b(mach-[a-z0-9-]+)\b/i);
  const machineId =
    machineMatch?.[1] ??
    (/filler|line\s*3/i.test(clean)
      ? "mach-l3-filler-01"
      : /cnc|line\s*1/i.test(clean)
        ? "mach-l1-cnc-01"
        : /mold|line\s*2/i.test(clean)
          ? "mach-l2-mold-01"
          : "mach-l1-cnc-01");

  const metricTag = /vibration|vib/i.test(lower)
    ? "vibration"
    : /pressure/i.test(lower)
      ? "pressure"
      : /speed/i.test(lower)
        ? "currentSpeed"
        : "temperature";

  const thresholdMatch = clean.match(/(?:>|>=|exceeds?|above|over)\s*(\d+(?:\.\d+)?)/i);
  const threshold = thresholdMatch
    ? Number(thresholdMatch[1])
    : metricTag === "vibration"
      ? 6.0
      : metricTag === "pressure"
        ? 115
        : 80;

  const isAlertTrigger = /\bwhen\b|\bthreshold\b|\bexceed|\bspike\b|\bmonitor/i.test(lower);
  const isScheduleTrigger = /\bevery\b|\bschedule\b|\bcron\b|\bhourly\b|\bdaily\b/i.test(lower);
  const triggerType: "manual" | "schedule" | "alert" | "connector" = isAlertTrigger
    ? "alert"
    : isScheduleTrigger
      ? "schedule"
      : "manual";

  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  let x = 80;
  const stepX = 240;

  const pushNode = (node: Omit<WorkflowNode, "position">) => {
    nodes.push({ ...node, position: { x, y: 120 } });
    if (nodes.length > 1) {
      const prev = nodes[nodes.length - 2]!;
      edges.push({
        id: `e-${edges.length + 1}`,
        source: prev.id,
        target: node.id
      });
    }
    x += stepX;
  };

  pushNode({
    id: "n1",
    type: "trigger",
    label:
      triggerType === "alert"
        ? `Trigger: ${machineId} ${metricTag} > ${threshold}`
        : triggerType === "schedule"
          ? "Scheduled Operations Check"
          : "Manual Trigger",
    config: {
      triggerType,
      machineId,
      metricTag,
      threshold
    }
  });

  if (isAlertTrigger) {
    pushNode({
      id: `n${nodes.length + 1}`,
      type: "condition",
      label: `If ${metricTag} > ${threshold}`,
      config: {
        machineId,
        metricTag,
        operator: "gt",
        threshold
      }
    });
  }

  if (/alarm|status|check|inspect/i.test(lower)) {
    pushNode({
      id: `n${nodes.length + 1}`,
      type: "mcp",
      label: "Check Active Alarms & Status",
      config: {
        tool: "get_active_alarms",
        args: { machineId }
      }
    });
  }

  if (/part|spare|inventory/i.test(lower)) {
    pushNode({
      id: `n${nodes.length + 1}`,
      type: "mcp",
      label: "Check Spare Parts Stock",
      config: {
        tool: "find_part_for_fault",
        args: { faultCode: /e42/i.test(lower) ? "E42" : "F104" }
      }
    });
  }

  if (/work\s*order|repair|dispatch|maintenance/i.test(lower)) {
    pushNode({
      id: `n${nodes.length + 1}`,
      type: "work_order",
      label: "Draft Maintenance Work Order",
      config: {
        machineId,
        priority: "high",
        description: clean.slice(0, 180)
      }
    });
  }

  if (/\bqueues?\b|\bdispatch\b/i.test(lower)) {
    pushNode({
      id: `n${nodes.length + 1}`,
      type: "queue",
      label: "Enqueue Maintenance Dispatch",
      config: {
        queueId: "queue-maintenance-dispatch"
      }
    });
  }

  if (/notify|notification|alert|slack|email/i.test(lower) || nodes.length < 2) {
    pushNode({
      id: `n${nodes.length + 1}`,
      type: "notify",
      label: "Publish Plant Alert Notification",
      config: {
        topicId: "topic-plant-alerts",
        severity: "high",
        title: `Workflow Alert: ${machineId}`,
        message: clean.slice(0, 220)
      }
    });
  }

  const shortTitle =
    clean.length > 56 ? `${clean.slice(0, 53).trim()}...` : clean;

  return {
    name: `AI: ${shortTitle}`,
    description: `Generated from prompt: ${clean}`,
    triggerType,
    triggerConfig: { machineId, metricTag, threshold },
    definition: { nodes, edges },
    nodes,
    edges
  };
}

export async function pruneWorkflowVersions(
  db: LuticDatabase,
  workflowId: string,
  tenantId: string,
  maxVersions = 5
): Promise<void> {
  const rows = await db
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflowId, workflowId),
        eq(workflowVersions.tenantId, tenantId)
      )
    )
    .orderBy(desc(workflowVersions.version));

  const staleIds = rows.slice(maxVersions).map((r) => r.id);
  if (staleIds.length > 0) {
    await db
      .delete(workflowVersions)
      .where(
        and(
          eq(workflowVersions.workflowId, workflowId),
          eq(workflowVersions.tenantId, tenantId),
          inArray(workflowVersions.id, staleIds)
        )
      );
  }
}

async function runMcpNodeAction(
  db: LuticDatabase,
  tenantId: string,
  tool: string,
  args: Record<string, unknown>,
  allowedPlantIds?: string[]
): Promise<Record<string, unknown>> {
  const machineId = typeof args.machineId === "string" ? args.machineId : undefined;
  const faultCode = typeof args.faultCode === "string" ? args.faultCode : undefined;

  if (tool === "get_machine" && machineId) {
    const conds = [eq(assets.id, machineId), eq(assets.tenantId, tenantId)];
    if (allowedPlantIds?.length) conds.push(inArray(assets.plantId, allowedPlantIds));
    const rows = await db.select().from(assets).where(and(...conds)).limit(1);
    return { found: Boolean(rows[0]), machine: rows[0] ?? null };
  }

  if (tool === "get_machine_status" && machineId) {
    const conds = [
      eq(machineStatus.machineId, machineId),
      eq(machineStatus.tenantId, tenantId)
    ];
    if (allowedPlantIds?.length) conds.push(inArray(machineStatus.plantId, allowedPlantIds));
    const rows = await db.select().from(machineStatus).where(and(...conds)).limit(1);
    return { found: Boolean(rows[0]), status: rows[0] ?? null };
  }

  if (tool === "get_active_alarms") {
    const conds = [eq(alarms.tenantId, tenantId), isNull(alarms.clearedAt)];
    if (machineId) conds.push(eq(alarms.machineId, machineId));
    if (allowedPlantIds?.length) conds.push(inArray(alarms.plantId, allowedPlantIds));
    const rows = await db.select().from(alarms).where(and(...conds)).limit(20);
    return { alarms: rows, count: rows.length };
  }

  if (tool === "find_part_for_fault" || tool === "get_parts_inventory") {
    const conds = [eq(parts.tenantId, tenantId)];
    if (allowedPlantIds?.length) conds.push(inArray(inventory.plantId, allowedPlantIds));
    const rows = await db
      .select({
        partNo: parts.partNo,
        description: parts.description,
        onHand: inventory.onHand,
        reserved: inventory.reserved,
        location: inventory.location
      })
      .from(parts)
      .innerJoin(inventory, eq(inventory.partId, parts.id))
      .where(and(...conds))
      .limit(10);
    return {
      faultCode: faultCode ?? null,
      parts: rows.map((r) => ({ ...r, available: Math.max(0, r.onHand - r.reserved) }))
    };
  }

  if (tool === "get_work_orders") {
    const conds = [eq(workOrders.tenantId, tenantId)];
    if (machineId) conds.push(eq(workOrders.machineId, machineId));
    if (allowedPlantIds?.length) conds.push(inArray(workOrders.plantId, allowedPlantIds));
    const rows = await db
      .select()
      .from(workOrders)
      .where(and(...conds))
      .orderBy(desc(workOrders.openedAt))
      .limit(15);
    return { workOrders: rows };
  }

  if (!isDemoMode()) throw new Error(`Workflow tool '${tool}' is unsupported or missing required arguments`);
  return { tool, args, ok: true };
}

function compareCondition(
  val: number,
  op: string,
  threshold: number
): boolean {
  switch (op) {
    case "gte":
    case ">=":
      return val >= threshold;
    case "lt":
    case "<":
      return val < threshold;
    case "lte":
    case "<=":
      return val <= threshold;
    case "eq":
    case "==":
      return val === threshold;
    case "gt":
    case ">":
    default:
      return val > threshold;
  }
}

async function executeWorkflowNodeStep(
  db: LuticDatabase,
  params: {
    runId: string;
    tenantId: string;
    workflowId: string;
    workflowName: string;
    input: Record<string, unknown>;
    allowedPlantIds?: string[];
  },
  node: WorkflowNode,
  context: Record<string, unknown>
): Promise<{ stepOutput: Record<string, unknown>; continueBranch: boolean }> {
  let stepOutput: Record<string, unknown> = {};
  let continueBranch = true;

  if (node.type === "trigger") {
    stepOutput = { triggered: true, input: params.input };
  } else if (node.type === "condition") {
    const machineId = String(node.config.machineId ?? context.machineId ?? "");
    const metricTag = String(node.config.metricTag ?? node.config.metric ?? "temperature");
    const op = String(node.config.operator ?? "gt");
    const threshold = Number(node.config.threshold ?? 0);
    let actualVal =
      typeof context[metricTag] === "number"
        ? Number(context[metricTag])
        : typeof context.metricValue === "number"
          ? Number(context.metricValue)
          : null;

    if (actualVal === null && machineId) {
      const conds = [
        eq(machineStatus.machineId, machineId),
        eq(machineStatus.tenantId, params.tenantId)
      ];
      if (params.allowedPlantIds?.length) {
        conds.push(inArray(machineStatus.plantId, params.allowedPlantIds));
      }
      const msRows = await db
        .select()
        .from(machineStatus)
        .where(and(...conds))
        .limit(1);
      const ms = msRows[0];
      if (ms) {
        if (metricTag === "vibration") actualVal = ms.vibration;
        else if (metricTag === "pressure") actualVal = ms.pressure;
        else if (metricTag === "currentSpeed") actualVal = ms.currentSpeed;
        else actualVal = ms.temperature;
      }
    }
    const matched = actualVal === null ? isDemoMode() : compareCondition(actualVal, op, threshold);
    continueBranch = matched;
    stepOutput = { metricTag, actualVal, operator: op, threshold, matched };
  } else if (node.type === "mcp") {
    const tool = String(node.config.tool ?? "get_active_alarms");
    const rawArgs =
      node.config.args && typeof node.config.args === "object"
        ? (node.config.args as Record<string, unknown>)
        : {};
    stepOutput = await runMcpNodeAction(
      db,
      params.tenantId,
      tool,
      { ...rawArgs, ...(context.machineId && !rawArgs.machineId ? { machineId: context.machineId } : {}) },
      params.allowedPlantIds
    );
  } else if (node.type === "ai") {
    const instruction = String(
      node.config.prompt ?? node.label ?? "Summarize workflow telemetry"
    );
    if (registeredWorkflowAiExecutor) {
      stepOutput = await registeredWorkflowAiExecutor({
        tenantId: params.tenantId,
        workflowId: params.workflowId,
        runId: params.runId,
        nodeId: node.id,
        label: node.label,
        prompt: instruction,
        context
      });
    } else if (isDemoMode()) {
      stepOutput = {
        summary: `AI Analysis (${instruction}): processed context keys [${Object.keys(context).join(", ")}]`
      };
    } else {
      throw new Error("Workflow AI steps require a configured workflow AI executor");
    }
  } else if (node.type === "notify") {
    const topicId = typeof node.config.topicId === "string" ? node.config.topicId : "";
    const title = String(node.config.title ?? `Workflow: ${params.workflowName}`);
    const message = String(
      node.config.message ??
        `Workflow '${params.workflowName}' executed (${JSON.stringify(context).slice(0, 140)})`
    );
    const severity =
      node.config.severity === "critical" ||
      node.config.severity === "high" ||
      node.config.severity === "warning"
        ? node.config.severity
        : "info";

    let published = false;
    if (topicId) {
      try {
        const pubRes = await publishToTopic(db, params.tenantId, topicId, {
          subject: title,
          message,
          severity,
          payload: { workflowId: params.workflowId, runId: params.runId }
        });
        published = Object.values(pubRes.deliveries).some((count) => count > 0);
        stepOutput = { topicId, deliveries: pubRes.deliveries, deliveryFailures: pubRes.deliveryFailures };
      } catch {
        published = false;
      }
    }
    if (!published) {
      const notifId = `notif-${crypto.randomUUID().slice(0, 12)}`;
      await db.insert(notifications).values({
        id: notifId,
        tenantId: params.tenantId,
        userId: null,
        topicId: null,
        channel: "workflow",
        severity,
        title,
        body: message,
        metadata: { workflowId: params.workflowId, runId: params.runId },
        read: false
      });
      stepOutput = { ...stepOutput, notified: true, notificationId: notifId };
    }
  } else if (node.type === "queue") {
    const queueId = String(node.config.queueId ?? "queue-maintenance-dispatch");
    try {
      const enq = await enqueueQueueMessage(db, params.tenantId, queueId, {
        body: {
          workflowId: params.workflowId,
          runId: params.runId,
          ...context
        },
        attributes: { source: "workflow" }
      });
      stepOutput = { enqueued: true, queueId, messageId: enq.id };
    } catch (err) {
      stepOutput = {
        enqueued: false,
        error: err instanceof Error ? err.message : "Queue unavailable"
      };
    }
  } else if (node.type === "work_order") {
    const machineId = String(node.config.machineId ?? context.machineId ?? "");
    if (machineId) {
      const conds = [eq(assets.id, machineId), eq(assets.tenantId, params.tenantId)];
      if (params.allowedPlantIds?.length) {
        conds.push(inArray(assets.plantId, params.allowedPlantIds));
      }
      const mRows = await db
        .select({ id: assets.id, plantId: assets.plantId })
        .from(assets)
        .where(and(...conds))
        .limit(1);
      if (mRows[0]) {
        const woId = `wo-wf-${crypto.randomUUID().slice(0, 8)}`;
        await db.insert(workOrders).values({
          id: woId,
          tenantId: params.tenantId,
          plantId: mRows[0].plantId,
          machineId: mRows[0].id,
          componentId: null,
          type: "corrective",
          priority: node.config.priority === "urgent" ? "urgent" : "high",
          status: "draft",
          faultCode: String(node.config.faultCode ?? ""),
          description: String(
            node.config.description ?? `Automated from workflow ${params.workflowName}`
          ),
          resolution: "",
          partsUsed: [],
          openedAt: new Date(),
          closedAt: null,
          technician: "Lutic Workflow"
        });
        stepOutput = { workOrderCreated: true, workOrderId: woId };
      } else {
        stepOutput = {
          workOrderCreated: false,
          reason: "Machine not found or outside authorized plant scope"
        };
      }
    }
  }

  return { stepOutput, continueBranch };
}

async function runWorkflowGraph(
  db: LuticDatabase,
  params: {
    runId: string;
    tenantId: string;
    workflowId: string;
    workflowName: string;
    definition: WorkflowDefinition;
    input: Record<string, unknown>;
    allowedPlantIds?: string[];
    initialStepTraces?: WorkflowStepTrace[];
    initialOutput?: Record<string, unknown>;
    onCheckpoint?: (state: {
      stepTraces: WorkflowStepTrace[];
      output: Record<string, unknown>;
    }) => Promise<void>;
  }
): Promise<{
  status: "succeeded" | "failed";
  output: Record<string, unknown>;
  stepTraces: WorkflowStepTrace[];
  error?: string;
}> {
  const { nodes, edges } = params.definition;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const n of nodes) {
    adj.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  for (const e of edges) {
    if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }
  }

  const queue: string[] = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id);
  if (queue.length === 0 && nodes[0]) {
    queue.push(nodes[0].id);
  }

  const visited = new Set<string>();
  const skippedRoots = new Set<string>();
  const priorTraces = (params.initialStepTraces ?? []).filter(
    (t) => t.status === "succeeded" || t.status === "skipped"
  );
  const checkpointMap = new Map(priorTraces.map((t) => [t.nodeId, t]));
  const stepTraces: WorkflowStepTrace[] = [...priorTraces];
  let context: Record<string, unknown> = {
    ...params.input,
    ...(params.initialOutput ?? {})
  };

  try {
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (!node) continue;

      const checkpointed = checkpointMap.get(node.id);
      if (checkpointed) {
        if (checkpointed.status === "succeeded") {
          const out = checkpointed.output ?? {};
          context = { ...context, ...out };
          const continueBranch = out.matched !== undefined ? Boolean(out.matched) : true;
          for (const nextId of adj.get(node.id) ?? []) {
            if (!visited.has(nextId)) {
              if (continueBranch) queue.push(nextId);
              else skippedRoots.add(nextId);
            }
          }
        }
        continue;
      }

      const maxRetries = Math.max(0, Math.min(3, Math.trunc(Number(node.config.retries ?? 0) || 0)));
      const retryDelayMs = Math.max(
        0,
        Math.min(500, Math.trunc(Number(node.config.retryDelayMs ?? 15) || 0))
      );
      const t0 = Date.now();
      let attempts = 0;
      let stepOutput: Record<string, unknown> = {};
      let continueBranch = true;
      let lastError: unknown;
      let succeeded = false;

      for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
        attempts = attempt;
        try {
          const res = await executeWorkflowNodeStep(db, params, node, context);
          stepOutput = res.stepOutput;
          continueBranch = res.continueBranch;
          succeeded = true;
          break;
        } catch (err) {
          lastError = err;
          if (attempt <= maxRetries && retryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }
        }
      }

      if (!succeeded) {
        const errMsg = lastError instanceof Error ? lastError.message : "Workflow step failed";
        stepTraces.push({
          nodeId: node.id,
          type: node.type,
          label: node.label,
          status: "failed",
          durationMs: Math.max(1, Date.now() - t0),
          attempts,
          checkpointedAt: new Date().toISOString(),
          error: errMsg
        });
        if (params.onCheckpoint) {
          await params.onCheckpoint({ stepTraces: [...stepTraces], output: context });
        }
        throw lastError instanceof Error ? lastError : new Error(errMsg);
      }

      context = { ...context, ...stepOutput };
      stepTraces.push({
        nodeId: node.id,
        type: node.type,
        label: node.label,
        status: "succeeded",
        durationMs: Math.max(1, Date.now() - t0),
        attempts,
        checkpointedAt: new Date().toISOString(),
        output: stepOutput
      });
      if (params.onCheckpoint) {
        await params.onCheckpoint({ stepTraces: [...stepTraces], output: context });
      }

      if (continueBranch) {
        for (const nextId of adj.get(node.id) ?? []) {
          if (!visited.has(nextId)) {
            queue.push(nextId);
          }
        }
      } else {
        for (const nextId of adj.get(node.id) ?? []) {
          if (!visited.has(nextId)) {
            skippedRoots.add(nextId);
          }
        }
      }
    }

    const skipQueue = Array.from(skippedRoots);
    const skippedSeen = new Set<string>();
    while (skipQueue.length > 0) {
      const sid = skipQueue.shift()!;
      if (visited.has(sid) || skippedSeen.has(sid)) continue;
      skippedSeen.add(sid);
      const snode = nodeMap.get(sid);
      if (snode && !checkpointMap.has(snode.id)) {
        stepTraces.push({
          nodeId: snode.id,
          type: snode.type,
          label: snode.label,
          status: "skipped",
          durationMs: 0,
          output: { reason: "Condition evaluated false" }
        });
      }
      for (const nextId of adj.get(sid) ?? []) {
        if (!visited.has(nextId) && !skippedSeen.has(nextId)) {
          skipQueue.push(nextId);
        }
      }
    }

    return {
      status: "succeeded",
      output: context,
      stepTraces
    };
  } catch (err) {
    return {
      status: "failed",
      output: context,
      stepTraces,
      error: err instanceof Error ? err.message : "Workflow execution failed"
    };
  }
}

async function persistWorkflowCheckpoint(
  db: LuticDatabase,
  runId: string,
  state: { stepTraces: WorkflowStepTrace[]; output: Record<string, unknown> }
): Promise<void> {
  await db
    .update(workflowRuns)
    .set({
      output: state.output,
      stepTraces: state.stepTraces as unknown as Array<Record<string, unknown>>
    })
    .where(eq(workflowRuns.id, runId));
}

export async function executeWorkflow(
  db: LuticDatabase,
  params: {
    tenantId: string;
    workflowId: string;
    triggerSource?: string;
    triggeredBy?: string;
    input?: Record<string, unknown>;
    allowedPlantIds?: string[];
  }
) {
  const wfRows = await db
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.id, params.workflowId),
        eq(workflows.tenantId, params.tenantId)
      )
    )
    .limit(1);

  const wf = wfRows[0];
  if (!wf) {
    throw new Error(`Workflow '${params.workflowId}' not found`);
  }

  const parsedDef = WorkflowDefinitionSchema.parse(wf.definition);
  const runId = `wfr-${crypto.randomUUID().slice(0, 12)}`;
  const startedAt = new Date();

  await db.insert(workflowRuns).values({
    id: runId,
    tenantId: params.tenantId,
    workflowId: wf.id,
    version: wf.currentVersion,
    status: "running",
    triggerSource: params.triggerSource ?? "manual",
    triggeredBy: params.triggeredBy ?? "system",
    input: params.input ?? {},
    stepTraces: [],
    startedAt
  });

  const outcome = await runWorkflowGraph(db, {
    runId,
    tenantId: params.tenantId,
    workflowId: wf.id,
    workflowName: wf.name,
    definition: parsedDef,
    input: params.input ?? {},
    allowedPlantIds: params.allowedPlantIds,
    onCheckpoint: (state) => persistWorkflowCheckpoint(db, runId, state)
  });

  const completedAt = new Date();
  await db
    .update(workflowRuns)
    .set({
      status: outcome.status,
      output: outcome.output,
      stepTraces: outcome.stepTraces as unknown as Array<Record<string, unknown>>,
      error: outcome.error ?? null,
      completedAt
    })
    .where(eq(workflowRuns.id, runId));

  const [updated] = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId))
    .limit(1);

  return updated!;
}

export async function resumeWorkflowRun(db: LuticDatabase, runId: string) {
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(workflowRuns)
      .set({ status: "running", error: null, completedAt: null })
      .where(and(eq(workflowRuns.id, runId), inArray(workflowRuns.status, ["failed", "running"])))
      .returning();
    return row;
  });
  if (!claimed) {
    throw new Error(`Workflow run '${runId}' is not resumable`);
  }

  const [wf] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, claimed.workflowId), eq(workflows.tenantId, claimed.tenantId)))
    .limit(1);

  if (!wf) {
    await db
      .update(workflowRuns)
      .set({ status: "failed", error: "Workflow definition missing", completedAt: new Date() })
      .where(eq(workflowRuns.id, runId));
    throw new Error("Workflow definition missing");
  }

  const parsedDef = WorkflowDefinitionSchema.parse(wf.definition);
  const outcome = await runWorkflowGraph(db, {
    runId: claimed.id,
    tenantId: claimed.tenantId,
    workflowId: wf.id,
    workflowName: wf.name,
    definition: parsedDef,
    input: claimed.input ?? {},
    initialStepTraces: (claimed.stepTraces ?? []) as unknown as WorkflowStepTrace[],
    initialOutput: (claimed.output ?? {}) as Record<string, unknown>,
    onCheckpoint: (state) => persistWorkflowCheckpoint(db, runId, state)
  });

  await db
    .update(workflowRuns)
    .set({
      status: outcome.status,
      output: outcome.output,
      stepTraces: outcome.stepTraces as unknown as Array<Record<string, unknown>>,
      error: outcome.error ?? null,
      completedAt: new Date()
    })
    .where(eq(workflowRuns.id, runId));

  const [updated] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
  return updated!;
}

export async function executeQueuedWorkflowRun(
  db: LuticDatabase,
  runId: string
): Promise<void> {
  const run = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(workflowRuns)
      .set({ status: "running" })
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.status, "queued")))
      .returning();
    return claimed;
  });
  if (!run) return;

  await executeClaimedWorkflowRun(db, run);
}

async function executeClaimedWorkflowRun(
  db: LuticDatabase,
  run: typeof workflowRuns.$inferSelect
): Promise<void> {
  const wfRows = await db
    .select()
    .from(workflows)
    .where(
      and(eq(workflows.id, run.workflowId), eq(workflows.tenantId, run.tenantId))
    )
    .limit(1);

  const wf = wfRows[0];
  if (!wf) {
    await db
      .update(workflowRuns)
      .set({
        status: "failed",
        error: "Workflow definition missing",
        completedAt: new Date()
      })
      .where(eq(workflowRuns.id, run.id));
    return;
  }

  const parsedDef = WorkflowDefinitionSchema.safeParse(wf.definition);
  if (!parsedDef.success) {
    await db
      .update(workflowRuns)
      .set({
        status: "failed",
        error: "Invalid workflow graph",
        completedAt: new Date()
      })
      .where(eq(workflowRuns.id, run.id));
    return;
  }

  const outcome = await runWorkflowGraph(db, {
    runId: run.id,
    tenantId: run.tenantId,
    workflowId: wf.id,
    workflowName: wf.name,
    definition: parsedDef.data,
    input: run.input ?? {},
    initialStepTraces: (run.stepTraces ?? []) as unknown as WorkflowStepTrace[],
    initialOutput: (run.output ?? {}) as Record<string, unknown>,
    onCheckpoint: (state) => persistWorkflowCheckpoint(db, run.id, state)
  });

  await db
    .update(workflowRuns)
    .set({
      status: outcome.status,
      output: outcome.output,
      stepTraces: outcome.stepTraces as unknown as Array<Record<string, unknown>>,
      error: outcome.error ?? null,
      completedAt: new Date()
    })
    .where(eq(workflowRuns.id, run.id));
}

// Register workflow executor hooks for topic/connector triggers and non-test background runtime
registerTopicWorkflowExecutor(executeQueuedWorkflowRun);
registerTriggerWorkflowExecutor(executeQueuedWorkflowRun);
if (!shouldSkipAutoRuntime()) {
  registerRuntimeHooks({ executeWorkflowRun: executeQueuedWorkflowRun });
}
