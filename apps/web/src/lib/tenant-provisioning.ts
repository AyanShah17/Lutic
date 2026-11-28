import crypto from "node:crypto";
import {
  auditLog,
  boardIssues,
  dashboards,
  dashboardVersions,
  installCoreToolkits,
  plants,
  queues,
  seedStarterSandboxServices,
  tenants,
  topics,
  userPlants,
  users,
  workflows,
  workflowVersions,
  type LuticDatabase,
  type SessionUser
} from "@lutic/core";

export interface ProvisionTenantInput {
  email: string;
  name: string;
  passwordHash: string;
  workspaceName?: string;
  externalAuthId?: string | null;
  authSource: "auth.signup" | "auth.clerk_provision";
}

export interface ProvisionedTenantResult {
  userRow: typeof users.$inferSelect;
  sessionUser: SessionUser;
  tenantId: string;
  plantId: string;
}

async function runTx<T>(
  db: LuticDatabase,
  fn: (tx: LuticDatabase) => Promise<T>
): Promise<T> {
  return (db as unknown as {
    transaction: (cb: (tx: LuticDatabase) => Promise<T>) => Promise<T>;
  }).transaction(fn);
}

/**
 * Atomically provisions a dedicated, isolated tenant workspace with core toolkits,
 * starter board issues, starter AI Canvas DAG workflow,
 * starter AI Dashboard, and pub/sub + queue channels.
 */
export async function provisionTenantWorkspace(
  db: LuticDatabase,
  input: ProvisionTenantInput
): Promise<ProvisionedTenantResult> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.name.trim() || email.split("@")[0] || "Lutic User";
  const orgName = input.workspaceName?.trim() || `${displayName}'s Workspace`;

  const tenantId = `tenant-${crypto.randomUUID().slice(0, 12)}`;
  const plantId = `plant-${crypto.randomUUID().slice(0, 12)}`;
  const userId = `user-${crypto.randomUUID().slice(0, 12)}`;
  const slug = `ws-${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date();

  const starterWorkflowId = `wf-${crypto.randomUUID().slice(0, 10)}`;
  const starterWorkflowDef = {
    nodes: [
      {
        id: "n1",
        type: "trigger",
        label: "Manual or Webhook Trigger",
        config: { triggerType: "manual" },
        position: { x: 80, y: 120 }
      },
      {
        id: "n2",
        type: "ai",
        label: "Autonomous Agent Analysis",
        config: { prompt: "Summarize incoming signal, check policy, and prepare recommended action" },
        position: { x: 340, y: 120 }
      },
      {
        id: "n3",
        type: "notify",
        label: "Human-in-the-Loop Dispatch",
        config: {
          topicId: `topic-${tenantId}-plant-alerts`,
          severity: "info",
          title: "Starter Agentic Triage Ready"
        },
        position: { x: 600, y: 120 }
      }
    ],
    edges: [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n3" }
    ]
  };

  const starterDashboardId = `dash-${crypto.randomUUID().slice(0, 8)}`;
  const starterDashboardSpec = {
    id: starterDashboardId,
    title: `${orgName} Overview`,
    description: "Governed AI KPIs, automation throughput, and operational health.",
    plantScope: [plantId],
    filters: { range: "7d" as const },
    widgets: [
      {
        id: "w-1",
        type: "kpi" as const,
        title: "Automation Effectiveness",
        metric: "oee",
        range: "7d" as const,
        target: 85
      },
      {
        id: "w-2",
        type: "kpi" as const,
        title: "Resolution Availability",
        metric: "availability",
        range: "7d" as const,
        target: 95
      }
    ],
    layout: [
      { i: "w-1", x: 0, y: 0, w: 6, h: 4 },
      { i: "w-2", x: 6, y: 0, w: 6, h: 4 }
    ],
    version: 1
  };

  const userRow = await runTx(db, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: orgName,
      slug,
      plan: "free"
    });

    await tx.insert(plants).values({
      id: plantId,
      tenantId,
      name: "Primary Workspace",
      code: "WS-01",
      timezone: "UTC",
      location: ""
    });

    const inserted = await tx
      .insert(users)
      .values({
        id: userId,
        tenantId,
        email,
        name: displayName,
        passwordHash: input.passwordHash,
        role: "admin",
        active: true,
        externalAuthId: input.externalAuthId ?? null
      })
      .returning();

    await tx.insert(userPlants).values({
      tenantId,
      userId,
      plantId
    });

    await installCoreToolkits(tx, tenantId, `${tenantId}-`);
    await seedStarterSandboxServices(tx, tenantId);

    await tx.insert(topics).values({
      id: `topic-${tenantId}-plant-alerts`,
      tenantId,
      name: "workspace-alerts",
      description: "Default workspace alerts, agent notifications, and event fan-out"
    });

    await tx.insert(queues).values({
      id: `queue-${tenantId}-agent-dispatch`,
      tenantId,
      name: "agent-dispatch",
      description: "Default durable agent & automation dispatch queue"
    });

    await tx.insert(boardIssues).values([
      {
        id: `brd-${crypto.randomUUID().slice(0, 10)}`,
        tenantId,
        plantId,
        identifier: "LUT-101",
        title: "Connect enterprise SaaS, ERP, cloud, or OT systems",
        description:
          "Configure SAP, AWS, ServiceNow, Slack, Linear, MQTT, OPC-UA, or OpenAPI endpoints in Connectors Hub.",
        status: "todo",
        priority: "high",
        category: "connector",
        assigneeName: displayName,
        labels: ["onboarding", "connectors"],
        sourceRef: "Lutic Connectors",
        createdBy: userId
      },
      {
        id: `brd-${crypto.randomUUID().slice(0, 10)}`,
        tenantId,
        plantId,
        identifier: "LUT-102",
        title: "Customize your starter AI Canvas workflow",
        description:
          "Open AI Canvas to connect triggers, AI Gateway reasoning steps, and Human-in-the-Loop approvals.",
        status: "in_progress",
        priority: "medium",
        category: "automation",
        assigneeName: displayName,
        labels: ["ai-canvas"],
        sourceRef: "AI Canvas",
        createdBy: userId
      },
      {
        id: `brd-${crypto.randomUUID().slice(0, 10)}`,
        tenantId,
        plantId,
        identifier: "LUT-103",
        title: "Ask Lutic AI Copilot & review Before / After diffs",
        description:
          "Open the floating Lutic AI assistant on any screen to propose edits, verify diffs, and persist changes.",
        status: "backlog",
        priority: "low",
        category: "operations",
        assigneeName: displayName,
        labels: ["ai-copilot", "hitl"],
        sourceRef: "Lutic AI",
        createdBy: userId
      }
    ]);

    await tx.insert(workflows).values({
      id: starterWorkflowId,
      tenantId,
      plantId,
      name: "Starter Agentic Triage & HITL Flow",
      description: "Pre-wired AI Canvas DAG ready to customize, run, and persist across sessions.",
      triggerType: "manual",
      triggerConfig: { starter: true },
      definition: starterWorkflowDef,
      enabled: true,
      currentVersion: 1,
      createdBy: userId,
      createdAt: now,
      updatedAt: now
    });

    await tx.insert(workflowVersions).values({
      id: `wfv-${starterWorkflowId}-v1`,
      tenantId,
      workflowId: starterWorkflowId,
      version: 1,
      definition: starterWorkflowDef,
      changeSummary: "Provisioned starter AI Canvas workflow",
      createdBy: userId
    });

    await tx.insert(dashboards).values({
      id: starterDashboardId,
      tenantId,
      ownerId: userId,
      title: starterDashboardSpec.title,
      description: starterDashboardSpec.description,
      plantScope: [plantId],
      spec: starterDashboardSpec as unknown as Record<string, unknown>,
      currentVersion: 1,
      isTemplate: false
    });

    await tx.insert(dashboardVersions).values({
      id: `dv-${starterDashboardId}-v1`,
      tenantId,
      dashboardId: starterDashboardId,
      version: 1,
      spec: starterDashboardSpec as unknown as Record<string, unknown>,
      createdBy: userId,
      changeSummary: "Provisioned starter AI Dashboard"
    });

    await tx.insert(auditLog).values({
      id: `aud-${crypto.randomUUID().slice(0, 12)}`,
      tenantId,
      userId,
      role: "admin",
      action: "signup_provisioned",
      toolName: input.authSource,
      args: { email, workspaceName: orgName, plan: "free" },
      resultHash: "",
      status: "allowed",
      reason: "Auto-provisioned Lutic SaaS workspace",
      latencyMs: 1
    });

    return inserted[0]!;
  });

  return {
    userRow,
    sessionUser: {
      userId: userRow.id,
      tenantId: userRow.tenantId,
      role: "admin",
      plantIds: [plantId],
      email: userRow.email,
      name: userRow.name
    },
    tenantId,
    plantId
  };
}
