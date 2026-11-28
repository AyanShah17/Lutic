import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  alertRules,
  and,
  assets,
  auditLog,
  authorize,
  boardIssues,
  buildWorkflowFromPrompt,
  can,
  computeAgentCapabilities,
  DashboardSpecSchema,
  dashboards,
  dashboardVersions,
  desc,
  eq,
  getTenantSandboxServices,
  inArray,
  resolveServiceIdFromPathname,
  workflows,
  workflowVersions,
  type AgentScopeId,
  type Permission
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { enforceApiQuota } from "@/lib/quota";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";
import type { ConnectionCategoryId, CustomSavedConnection } from "@/lib/machine-topology";

export interface ChangeDiffRow {
  field: string;
  before: string;
  after: string;
}

export interface AiChangeProposal {
  id: string;
  scope: "screen" | "global";
  targetType: "machine_connection" | "machine_criticality" | "dashboard" | "workflow" | "alert_rule" | "board_issue";
  targetId: string;
  targetLabel: string;
  summary: string;
  permissionRequired: Permission;
  canSave: boolean;
  plantId?: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  diffRows: ChangeDiffRow[];
  mutation: Record<string, unknown>;
}

const ServiceIdEnum = z.enum([
  "overview",
  "board",
  "machines",
  "monitoring",
  "dashboards",
  "workflows",
  "connectors",
  "notifications",
  "queues"
]);

const ProposeSchema = z.object({
  mode: z.literal("propose"),
  prompt: z.string().trim().min(2).max(1500),
  scope: z.enum(["screen", "global"]).default("screen"),
  pathname: z.string().default("/"),
  selectedEntityId: z.string().optional(),
  serviceId: ServiceIdEnum.optional()
});

const SaveSchema = z.object({
  mode: z.literal("save"),
  serviceId: ServiceIdEnum.optional(),
  proposal: z.object({
    id: z.string().min(1),
    scope: z.enum(["screen", "global"]),
    targetType: z.enum([
      "machine_connection",
      "machine_criticality",
      "dashboard",
      "workflow",
      "alert_rule",
      "board_issue"
    ]),
    targetId: z.string().min(1),
    targetLabel: z.string().min(1),
    summary: z.string().min(1),
    permissionRequired: z.string().min(1),
    plantId: z.string().optional(),
    before: z.record(z.string(), z.unknown()),
    after: z.record(z.string(), z.unknown()),
    diffRows: z.array(
      z.object({
        field: z.string(),
        before: z.string(),
        after: z.string()
      })
    ),
    mutation: z.record(z.string(), z.unknown())
  })
});

function inferConnectionCategory(text: string): ConnectionCategoryId {
  const lower = text.toLowerCase();
  if (/air|pneum|bar|pressure|coolant|chiller|utility|comp/.test(lower)) return "pneumatic_utility";
  if (/robot|pick|pallet|tend/.test(lower)) return "robotic_handling";
  if (/safe|loto|interlock|curtain|gate/.test(lower)) return "safety_interlock";
  if (/spare|sop|backup|failover|parallel/.test(lower)) return "shared_spares_sop";
  return "material_flow";
}

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "docs:read", { tenantId: user.tenantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.tenantId, user.tenantId),
            eq(auditLog.action, "ai_change_save")
          )
        )
        .orderBy(desc(auditLog.createdAt))
        .limit(30);

      const changes = rows.map((r) => {
        const a = (r.args ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          savedAt: r.createdAt.toISOString(),
          savedBy: r.userId,
          scope: String(a.scope ?? "screen"),
          targetType: String(a.targetType ?? "board_issue"),
          targetId: String(a.targetId ?? ""),
          targetLabel: String(a.targetLabel ?? r.reason),
          summary: String(a.summary ?? r.reason),
          before: (a.before ?? {}) as Record<string, unknown>,
          after: (a.after ?? {}) as Record<string, unknown>,
          diffRows: Array.isArray(a.diffRows) ? (a.diffRows as ChangeDiffRow[]) : []
        };
      });

      return NextResponse.json({ changes });
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

    const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw || (raw.mode !== "propose" && raw.mode !== "save")) {
      return problemResponse(400, "Validation Error", "mode must be 'propose' or 'save'.");
    }

    if (raw.mode === "propose") {
      authorize(user, "docs:read", { tenantId: user.tenantId });
      const body = ProposeSchema.parse(raw);
      const lower = body.prompt.toLowerCase();
      const path = body.pathname;
      const onMachines = body.scope === "screen" && (path.startsWith("/machines") || path.startsWith("/m/"));
      const onDashboards = body.scope === "screen" && path.startsWith("/dashboards");
      const onWorkflows = body.scope === "screen" && path.startsWith("/workflows");
      const onMonitoring = body.scope === "screen" && path.startsWith("/monitoring");
      const onBoard = body.scope === "screen" && path.startsWith("/board");
      const effectiveServiceId: AgentScopeId =
        body.serviceId ??
        (body.scope === "global" ? "overview" : resolveServiceIdFromPathname(path));

      return await withWebTenantDb(user.tenantId, async (db) => {
        const quotaErr = await enforceApiQuota(req, db, user, "ai");
        if (quotaErr) return quotaErr;
        const sandboxServices = await getTenantSandboxServices(db, user.tenantId);
        const caps = computeAgentCapabilities(sandboxServices, effectiveServiceId);
        if (!caps.enabled) {
          return problemResponse(
            403,
            "Service Not Enabled",
            `${caps.agentName} cannot propose changes because service '${effectiveServiceId}' is not enabled in your sandbox.`
          );
        }

        const guardProposal = (proposal: AiChangeProposal) => {
          if (!caps.allowedChangeTypes.has(proposal.targetType)) {
            return problemResponse(
              403,
              "Service Agent Isolation",
              `${caps.agentName} can only modify ${Array.from(caps.allowedChangeTypes).join(", ") || "no workspace resources"} (attempted '${proposal.targetType}'). Switch to Overview Agent for cross-service edits.`
            );
          }
          return NextResponse.json({ proposal });
        };

        if (!caps.isOverview) {
          if (/\b(create|new|toggle|pause|enable|disable)\b.*\bworkflow\b|\bworkflow\b.*\b(when|trigger)\b/i.test(body.prompt) && !caps.allowedChangeTypes.has("workflow")) {
            return problemResponse(
              403,
              "Service Agent Isolation",
              `${caps.agentName} cannot modify workflows. Switch to Overview Agent or open AI Canvas.`
            );
          }
          if (/\b(alert\s*rule|threshold)\b/i.test(body.prompt) && !caps.allowedChangeTypes.has("alert_rule")) {
            return problemResponse(
              403,
              "Service Agent Isolation",
              `${caps.agentName} cannot modify monitoring alert rules. Switch to Overview Agent or open Monitoring.`
            );
          }
        }

        const machineIdsInPrompt = Array.from(body.prompt.matchAll(/\bmach-[a-z0-9-]+\b/gi)).map((m) =>
          m[0].toLowerCase()
        );

        // 1. Machine Topology Connection or Criticality Change
        if (
          (caps.isOverview ||
            caps.allowedChangeTypes.has("machine_connection") ||
            caps.allowedChangeTypes.has("machine_criticality")) &&
          (onMachines ||
            machineIdsInPrompt.length >= 2 ||
            (/connect|link|pipe|conveyor|interlock|criticality/.test(lower) && !onWorkflows))
        ) {
          const scopeFilter =
            user.plantIds.length > 0
              ? and(
                  eq(assets.tenantId, user.tenantId),
                  eq(assets.type, "machine"),
                  inArray(assets.plantId, user.plantIds)
                )
              : and(eq(assets.tenantId, user.tenantId), eq(assets.type, "machine"));

          const plantMachines = await db.select().from(assets).where(scopeFilter);
          if (plantMachines.length >= 1) {
            const byId = new Map(plantMachines.map((m) => [m.id.toLowerCase(), m]));
            const firstMachine =
              (machineIdsInPrompt[0] ? byId.get(machineIdsInPrompt[0]) : undefined) ??
              (body.selectedEntityId ? byId.get(body.selectedEntityId.toLowerCase()) : undefined) ??
              plantMachines[0]!;

            if (/criticality/.test(lower)) {
              const targetCritMatch = body.prompt.match(/\b([ABC])\b/);
              const nextCrit = (targetCritMatch?.[1] as "A" | "B" | "C") ??
                (firstMachine.criticality === "A" ? "B" : "A");
              const proposal: AiChangeProposal = {
                id: `prop-${crypto.randomUUID().slice(0, 8)}`,
                scope: body.scope,
                targetType: "machine_criticality",
                targetId: firstMachine.id,
                targetLabel: firstMachine.name,
                summary: `Update criticality tier of ${firstMachine.name} from ${firstMachine.criticality} to ${nextCrit}`,
                permissionRequired: "admin:assets",
                canSave: can(user, "admin:assets"),
                plantId: firstMachine.plantId,
                before: {
                  machineId: firstMachine.id,
                  name: firstMachine.name,
                  criticality: firstMachine.criticality
                },
                after: {
                  machineId: firstMachine.id,
                  name: firstMachine.name,
                  criticality: nextCrit
                },
                diffRows: [
                  {
                    field: "Criticality Tier",
                    before: firstMachine.criticality,
                    after: nextCrit
                  }
                ],
                mutation: { criticality: nextCrit }
              };
              return guardProposal(proposal);
            }

            const secondMachine =
              (machineIdsInPrompt[1] ? byId.get(machineIdsInPrompt[1]) : undefined) ??
              plantMachines.find((m) => m.id !== firstMachine.id && m.parentId === firstMachine.parentId) ??
              plantMachines.find((m) => m.id !== firstMachine.id);

            if (secondMachine) {
              const cat = inferConnectionCategory(body.prompt);
              const existingCustom = Array.isArray(firstMachine.metadata?.customConnections)
                ? (firstMachine.metadata?.customConnections as CustomSavedConnection[])
                : [];
              const newLabel =
                body.prompt.length <= 42
                  ? body.prompt
                  : cat === "pneumatic_utility"
                    ? "6.2 bar Auxiliary Line"
                    : cat === "safety_interlock"
                      ? "Interlock Guard Link"
                      : cat === "robotic_handling"
                        ? "Automated Transfer Cell"
                        : "Process Feed Link";

              const newConn: CustomSavedConnection = {
                id: `conn-${crypto.randomUUID().slice(0, 8)}`,
                sourceId: firstMachine.id,
                targetId: secondMachine.id,
                category: cat,
                label: newLabel,
                spec: body.prompt,
                updatedAt: new Date().toISOString()
              };

              const perm: Permission = can(user, "admin:assets") ? "admin:assets" : "workorder:write";
              const proposal: AiChangeProposal = {
                id: `prop-${crypto.randomUUID().slice(0, 8)}`,
                scope: body.scope,
                targetType: "machine_connection",
                targetId: firstMachine.id,
                targetLabel: `${firstMachine.id} -> ${secondMachine.id}`,
                summary: `Add ${cat.replace("_", " ")} connection from ${firstMachine.name} to ${secondMachine.name}`,
                permissionRequired: perm,
                canSave: can(user, perm),
                plantId: firstMachine.plantId,
                before: {
                  sourceId: firstMachine.id,
                  savedConnections: existingCustom.length,
                  connectionsPreview: existingCustom.map((c) => `${c.sourceId} -> ${c.targetId} (${c.label})`)
                },
                after: {
                  sourceId: firstMachine.id,
                  savedConnections: existingCustom.length + 1,
                  addedConnection: newConn
                },
                diffRows: [
                  {
                    field: "Topology Connections",
                    before: `${existingCustom.length} custom link(s)`,
                    after: `${existingCustom.length + 1} custom link(s)`
                  },
                  {
                    field: "Added Edge",
                    before: "None",
                    after: `${firstMachine.id} -> ${secondMachine.id} [${cat}: ${newLabel}]`
                  }
                ],
                mutation: { newConnection: newConn }
              };
              return guardProposal(proposal);
            }
          }
        }

        // 2. Dashboard Spec Refinement
        if (
          (caps.isOverview || caps.allowedChangeTypes.has("dashboard")) &&
          (onDashboards || /dashboard|widget|oee|scrap|energy|30d/.test(lower))
        ) {
          const dashRows = await db
            .select()
            .from(dashboards)
            .where(eq(dashboards.tenantId, user.tenantId))
            .limit(10);
          const targetDash =
            (body.selectedEntityId ? dashRows.find((d) => d.id === body.selectedEntityId) : undefined) ??
            dashRows[0];
          if (targetDash) {
            const parsedSpec = DashboardSpecSchema.parse(targetDash.spec);
            const nextWidgets = parsedSpec.widgets.map((w) => ({ ...w }));
            const nextLayout = parsedSpec.layout.map((l) => ({ ...l }));
            let nextRange = parsedSpec.filters.range ?? "7d";
            const diffs: ChangeDiffRow[] = [];

            if (/30\s*d|30 days/.test(lower) && nextRange !== "30d") {
              diffs.push({ field: "Time Range", before: nextRange, after: "30d" });
              nextRange = "30d";
              for (const w of nextWidgets) w.range = "30d";
            } else {
              const metric = /energy/.test(lower)
                ? "energy_kwh"
                : /scrap/.test(lower)
                  ? "scrap_rate"
                  : /downtime/.test(lower)
                    ? "downtime_minutes"
                    : "oee";
              const wId = `w-${nextWidgets.length + 1}`;
              const title =
                metric === "energy_kwh"
                  ? "Energy Usage (kWh) by Line"
                  : metric === "scrap_rate"
                    ? "Scrap Rate by Defect"
                    : metric === "downtime_minutes"
                      ? "Downtime by Reason Code"
                      : "OEE by Line (AI Added)";
              nextWidgets.push({
                id: wId,
                type: "bar",
                title,
                metric,
                groupBy: metric === "scrap_rate" ? "defect_type" : "line",
                range: nextRange,
                sort: "desc",
                limit: 12
              });
              nextLayout.push({ i: wId, x: (nextWidgets.length % 2) * 6, y: 12, w: 6, h: 5 });
              diffs.push({
                field: "Widget Count",
                before: `${parsedSpec.widgets.length} widgets`,
                after: `${nextWidgets.length} widgets (+${title})`
              });
            }

            const nextSpec = DashboardSpecSchema.parse({
              ...parsedSpec,
              filters: { ...parsedSpec.filters, range: nextRange },
              widgets: nextWidgets,
              layout: nextLayout
            });

            const proposal: AiChangeProposal = {
              id: `prop-${crypto.randomUUID().slice(0, 8)}`,
              scope: body.scope,
              targetType: "dashboard",
              targetId: targetDash.id,
              targetLabel: targetDash.title,
              summary: `Update dashboard "${targetDash.title}" (v${targetDash.currentVersion} -> v${targetDash.currentVersion + 1})`,
              permissionRequired: "dashboard:write",
              canSave: can(user, "dashboard:write"),
              before: {
                version: targetDash.currentVersion,
                range: parsedSpec.filters.range ?? "7d",
                widgets: parsedSpec.widgets.map((w) => w.title)
              },
              after: {
                version: targetDash.currentVersion + 1,
                range: nextRange,
                widgets: nextSpec.widgets.map((w) => w.title)
              },
              diffRows: diffs,
              mutation: { spec: nextSpec }
            };
            return guardProposal(proposal);
          }
        }

        // 3. Workflow Update or Creation
        if (
          (caps.isOverview || caps.allowedChangeTypes.has("workflow")) &&
          (onWorkflows || /workflow|dag|automation/.test(lower))
        ) {
          const wfRows = await db
            .select()
            .from(workflows)
            .where(eq(workflows.tenantId, user.tenantId))
            .limit(10);
          const targetWf =
            (body.selectedEntityId ? wfRows.find((w) => w.id === body.selectedEntityId) : undefined) ??
            wfRows[0];

          if (targetWf && (/toggle|enable|disable|pause/.test(lower) || !/create|new/.test(lower))) {
            const nextEnabled = /disable|pause/.test(lower)
              ? false
              : /enable|activate/.test(lower)
                ? true
                : !targetWf.enabled;
            const proposal: AiChangeProposal = {
              id: `prop-${crypto.randomUUID().slice(0, 8)}`,
              scope: body.scope,
              targetType: "workflow",
              targetId: targetWf.id,
              targetLabel: targetWf.name,
              summary: `${nextEnabled ? "Enable" : "Pause"} workflow "${targetWf.name}"`,
              permissionRequired: "workflow:write",
              canSave: can(user, "workflow:write"),
              plantId: targetWf.plantId ?? undefined,
              before: {
                workflowId: targetWf.id,
                name: targetWf.name,
                enabled: targetWf.enabled,
                version: targetWf.currentVersion
              },
              after: {
                workflowId: targetWf.id,
                name: targetWf.name,
                enabled: nextEnabled,
                version: targetWf.currentVersion + 1
              },
              diffRows: [
                {
                  field: "Enabled State",
                  before: targetWf.enabled ? "Enabled" : "Paused",
                  after: nextEnabled ? "Enabled" : "Paused"
                }
              ],
              mutation: { enabled: nextEnabled }
            };
            return guardProposal(proposal);
          }

          const draft = buildWorkflowFromPrompt(body.prompt);
          const newWfId = `wf-${crypto.randomUUID().slice(0, 8)}`;
          const proposal: AiChangeProposal = {
            id: `prop-${crypto.randomUUID().slice(0, 8)}`,
            scope: body.scope,
            targetType: "workflow",
            targetId: newWfId,
            targetLabel: draft.name,
            summary: `Create automated workflow "${draft.name}" (${draft.definition.nodes.length} nodes)`,
            permissionRequired: "workflow:write",
            canSave: can(user, "workflow:write"),
            plantId: user.plantIds[0],
            before: { status: "Not created" },
            after: {
              id: newWfId,
              name: draft.name,
              triggerType: draft.triggerType,
              nodeCount: draft.definition.nodes.length
            },
            diffRows: [
              { field: "Workflow", before: "None", after: `${draft.name} (${draft.triggerType})` },
              {
                field: "Nodes",
                before: "0 nodes",
                after: draft.definition.nodes.map((n) => n.label).join(" -> ")
              }
            ],
            mutation: { createDraft: draft }
          };
          return guardProposal(proposal);
        }

        // 4. Monitoring Threshold Rule
        if (
          (caps.isOverview || caps.allowedChangeTypes.has("alert_rule")) &&
          (onMonitoring || /threshold|alert rule|alarm rule/.test(lower))
        ) {
          const ruleRows = await db
            .select()
            .from(alertRules)
            .where(eq(alertRules.tenantId, user.tenantId))
            .limit(10);
          const targetRule = ruleRows[0];
          const numMatch = body.prompt.match(/(\d+(?:\.\d+)?)/);
          const nextThreshold = numMatch
            ? Number(numMatch[1])
            : Number(((targetRule?.threshold ?? 80) * 0.95).toFixed(1));

          if (targetRule) {
            const proposal: AiChangeProposal = {
              id: `prop-${crypto.randomUUID().slice(0, 8)}`,
              scope: body.scope,
              targetType: "alert_rule",
              targetId: targetRule.id,
              targetLabel: targetRule.name,
              summary: `Adjust alert threshold for "${targetRule.name}" (${targetRule.threshold} -> ${nextThreshold})`,
              permissionRequired: "alert:write",
              canSave: can(user, "alert:write"),
              plantId: targetRule.plantId ?? undefined,
              before: {
                name: targetRule.name,
                metricTag: targetRule.metricTag,
                threshold: targetRule.threshold
              },
              after: {
                name: targetRule.name,
                metricTag: targetRule.metricTag,
                threshold: nextThreshold
              },
              diffRows: [
                {
                  field: `${targetRule.metricTag} Threshold`,
                  before: String(targetRule.threshold),
                  after: String(nextThreshold)
                }
              ],
              mutation: { threshold: nextThreshold }
            };
            return guardProposal(proposal);
          }
        }

        // 5. Execution Board Issue / Global Task Fallback
        const existingIssues = await db
          .select()
          .from(boardIssues)
          .where(eq(boardIssues.tenantId, user.tenantId))
          .orderBy(desc(boardIssues.updatedAt))
          .limit(20);

        const idMatch = body.prompt.match(/\bLUT-\d+\b/i);
        const matchedIssue = idMatch
          ? existingIssues.find((i) => i.identifier.toLowerCase() === idMatch[0].toLowerCase())
          : onBoard && body.selectedEntityId
            ? existingIssues.find((i) => i.id === body.selectedEntityId)
            : undefined;

        if (matchedIssue) {
          const nextStatus = /done|close|complete|resolve/.test(lower)
            ? "done"
            : /progress|start/.test(lower)
              ? "in_progress"
              : /review/.test(lower)
                ? "in_review"
                : matchedIssue.status === "todo"
                  ? "in_progress"
                  : "in_review";
          const nextPriority = /urgent|critical/.test(lower)
            ? "urgent"
            : /high/.test(lower)
              ? "high"
              : matchedIssue.priority;

          const proposal: AiChangeProposal = {
            id: `prop-${crypto.randomUUID().slice(0, 8)}`,
            scope: body.scope,
            targetType: "board_issue",
            targetId: matchedIssue.id,
            targetLabel: `${matchedIssue.identifier} · ${matchedIssue.title}`,
            summary: `Update board issue ${matchedIssue.identifier} (${matchedIssue.status} -> ${nextStatus})`,
            permissionRequired: "workorder:write",
            canSave: can(user, "workorder:write"),
            plantId: matchedIssue.plantId ?? undefined,
            before: {
              identifier: matchedIssue.identifier,
              status: matchedIssue.status,
              priority: matchedIssue.priority
            },
            after: {
              identifier: matchedIssue.identifier,
              status: nextStatus,
              priority: nextPriority
            },
            diffRows: [
              { field: "Status", before: matchedIssue.status, after: nextStatus },
              ...(nextPriority !== matchedIssue.priority
                ? [{ field: "Priority", before: matchedIssue.priority, after: nextPriority }]
                : [])
            ],
            mutation: { status: nextStatus, priority: nextPriority }
          };
          return guardProposal(proposal);
        }

        const nextIdentifier = `LUT-${100 + existingIssues.length + 1}`;
        const newIssueId = `iss-${crypto.randomUUID().slice(0, 8)}`;
        const priority = /urgent|critical|stop|fault/.test(lower)
          ? "urgent"
          : /high/.test(lower)
            ? "high"
            : "medium";
        const category = /connector|sap|servicenow|mqtt/.test(lower)
          ? "connector"
          : /workflow|automat/.test(lower)
            ? "automation"
            : /fault|alarm|alert/.test(lower)
              ? "incident"
              : "operations";

        const proposal: AiChangeProposal = {
          id: `prop-${crypto.randomUUID().slice(0, 8)}`,
          scope: body.scope,
          targetType: "board_issue",
          targetId: newIssueId,
          targetLabel: `${nextIdentifier} · ${body.prompt.slice(0, 64)}`,
          summary: `Create tracked board item ${nextIdentifier} (${body.scope === "global" ? "Global" : path})`,
          permissionRequired: "workorder:write",
          canSave: can(user, "workorder:write"),
          plantId: user.plantIds[0],
          before: { status: "Not in execution board" },
          after: {
            identifier: nextIdentifier,
            title: body.prompt.slice(0, 120),
            status: "todo",
            priority,
            category,
            sourceRef: body.scope === "global" ? "global-ai-copilot" : `screen:${path}`
          },
          diffRows: [
            { field: "Execution Board Item", before: "None", after: `${nextIdentifier}: ${body.prompt.slice(0, 72)}` },
            { field: "Priority / Category", before: "Unassigned", after: `${priority} / ${category}` }
          ],
          mutation: {
            createIssue: {
              id: newIssueId,
              identifier: nextIdentifier,
              title: body.prompt.slice(0, 120),
              description: `Created via Lutic Floating AI Assistant (${body.scope} scope on ${path}).`,
              status: "todo",
              priority,
              category,
              plantId: user.plantIds[0] ?? null,
              sourceRef: body.scope === "global" ? "global-ai-copilot" : `screen:${path}`
            }
          }
        };
        return guardProposal(proposal);
      });
    }

    // mode === "save"
    const body = SaveSchema.parse(raw);
    const p = body.proposal;
    const perm = p.permissionRequired as Permission;
    authorize(user, perm, {
      tenantId: user.tenantId,
      plantId: p.plantId
    });

    const saveServiceId: AgentScopeId = body.serviceId ?? "overview";

    return await withWebTenantDb(user.tenantId, async (db) => {
      const sandboxServices = await getTenantSandboxServices(db, user.tenantId);
      const saveCaps = computeAgentCapabilities(sandboxServices, saveServiceId);
      if (!saveCaps.enabled || !saveCaps.allowedChangeTypes.has(p.targetType)) {
        return problemResponse(
          403,
          "Service Agent Isolation",
          `${saveCaps.agentName} cannot save changes of type '${p.targetType}'.`
        );
      }
      if (p.targetType === "machine_criticality") {
        const nextCrit = String(p.mutation.criticality ?? "A") as "A" | "B" | "C";
        const [updated] = await db
          .update(assets)
          .set({ criticality: nextCrit })
          .where(and(eq(assets.id, p.targetId), eq(assets.tenantId, user.tenantId)))
          .returning();
        if (!updated) return problemResponse(404, "Not Found", "Target machine not found.");
      } else if (p.targetType === "machine_connection") {
        const [machine] = await db
          .select()
          .from(assets)
          .where(and(eq(assets.id, p.targetId), eq(assets.tenantId, user.tenantId)))
          .limit(1);
        if (!machine) return problemResponse(404, "Not Found", "Source machine not found.");
        const meta = (machine.metadata ?? {}) as Record<string, unknown>;
        const existingCustom = Array.isArray(meta.customConnections)
          ? (meta.customConnections as CustomSavedConnection[])
          : [];
        const added = p.mutation.newConnection as CustomSavedConnection;
        await db
          .update(assets)
          .set({
            metadata: {
              ...meta,
              customConnections: [...existingCustom, added]
            }
          })
          .where(eq(assets.id, machine.id));
      } else if (p.targetType === "dashboard") {
        const [dash] = await db
          .select()
          .from(dashboards)
          .where(and(eq(dashboards.id, p.targetId), eq(dashboards.tenantId, user.tenantId)))
          .limit(1);
        if (!dash) return problemResponse(404, "Not Found", "Dashboard not found.");
        const spec = DashboardSpecSchema.parse(p.mutation.spec);
        const nextVer = dash.currentVersion + 1;
        await db
          .update(dashboards)
          .set({ spec: spec as unknown as Record<string, unknown>, currentVersion: nextVer, updatedAt: new Date() })
          .where(eq(dashboards.id, dash.id));
        await db.insert(dashboardVersions).values({
          id: `dv-${crypto.randomUUID().slice(0, 10)}`,
          tenantId: user.tenantId,
          dashboardId: dash.id,
          version: nextVer,
          spec: spec as unknown as Record<string, unknown>,
          createdBy: user.userId,
          changeSummary: p.summary
        });
      } else if (p.targetType === "workflow") {
        if (p.mutation.createDraft) {
          const draft = p.mutation.createDraft as ReturnType<typeof buildWorkflowFromPrompt>;
          await db.insert(workflows).values({
            id: p.targetId,
            tenantId: user.tenantId,
            plantId: p.plantId ?? null,
            name: draft.name,
            description: draft.description,
            triggerType: draft.triggerType,
            triggerConfig: {},
            definition: draft.definition as unknown as Record<string, unknown>,
            enabled: true,
            currentVersion: 1,
            createdBy: user.userId
          });
          await db.insert(workflowVersions).values({
            id: `wfv-${crypto.randomUUID().slice(0, 10)}`,
            tenantId: user.tenantId,
            workflowId: p.targetId,
            version: 1,
            definition: draft.definition as unknown as Record<string, unknown>,
            changeSummary: p.summary,
            createdBy: user.userId
          });
        } else {
          const [wf] = await db
            .select()
            .from(workflows)
            .where(and(eq(workflows.id, p.targetId), eq(workflows.tenantId, user.tenantId)))
            .limit(1);
          if (!wf) return problemResponse(404, "Not Found", "Workflow not found.");
          await db
            .update(workflows)
            .set({
              enabled: Boolean(p.mutation.enabled),
              currentVersion: wf.currentVersion + 1,
              updatedAt: new Date()
            })
            .where(eq(workflows.id, wf.id));
        }
      } else if (p.targetType === "alert_rule") {
        const threshold = Number(p.mutation.threshold);
        const [updated] = await db
          .update(alertRules)
          .set({ threshold, updatedAt: new Date() })
          .where(and(eq(alertRules.id, p.targetId), eq(alertRules.tenantId, user.tenantId)))
          .returning();
        if (!updated) return problemResponse(404, "Not Found", "Alert rule not found.");
      } else if (p.targetType === "board_issue") {
        if (p.mutation.createIssue) {
          const ci = p.mutation.createIssue as {
            id: string;
            identifier: string;
            title: string;
            description: string;
            status: "todo";
            priority: "urgent" | "high" | "medium" | "low";
            category: "operations" | "automation" | "incident" | "connector" | "agent";
            plantId: string | null;
            sourceRef: string;
          };
          await db.insert(boardIssues).values({
            ...ci,
            tenantId: user.tenantId,
            assigneeName: user.name,
            labels: ["ai-copilot"],
            createdBy: user.userId
          });
        } else {
          const [updated] = await db
            .update(boardIssues)
            .set({
              status: String(p.mutation.status) as "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled",
              priority: String(p.mutation.priority) as "urgent" | "high" | "medium" | "low",
              updatedAt: new Date()
            })
            .where(and(eq(boardIssues.id, p.targetId), eq(boardIssues.tenantId, user.tenantId)))
            .returning();
          if (!updated) return problemResponse(404, "Not Found", "Board issue not found.");
        }
      }

      const auditId = `aud-ai-${crypto.randomUUID().slice(0, 10)}`;
      const savedAt = new Date();
      await db.insert(auditLog).values({
        id: auditId,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "ai_change_save",
        toolName: "ai.copilot.save_change",
        args: {
          scope: p.scope,
          targetType: p.targetType,
          targetId: p.targetId,
          targetLabel: p.targetLabel,
          summary: p.summary,
          before: p.before,
          after: p.after,
          diffRows: p.diffRows
        },
        resultHash: "",
        status: "confirmed",
        reason: p.summary,
        latencyMs: 1
      });

      return NextResponse.json({
        saved: {
          id: auditId,
          savedAt: savedAt.toISOString(),
          savedBy: user.userId,
          scope: p.scope,
          targetType: p.targetType,
          targetId: p.targetId,
          targetLabel: p.targetLabel,
          summary: p.summary,
          before: p.before,
          after: p.after,
          diffRows: p.diffRows
        }
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
