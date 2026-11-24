import { z } from "zod";
import {
  alertEvents,
  alertRules,
  and,
  desc,
  eq,
  executeWorkflow,
  inArray,
  isNull,
  listQueueSummaries,
  or,
  publishToTopic,
  topics,
  workflows,
  type KojoDatabase
} from "@kojo/core";
import {
  boundRows,
  buildConnectorMcpServer,
  type Connector,
  type ConnectorHealth,
  type ConnectorToolDefinition
} from "../types";

const PaasCredentialSchema = z.object({
  mode: z.string().default("in_memory_paas")
});

const ListWorkflowsSchema = z.object({
  enabledOnly: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(50).optional().default(20)
});

const TriggerWorkflowSchema = z.object({
  workflowId: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional().default({})
});

const ListAlertsSchema = z.object({
  status: z.enum(["OK", "ALARM", "ACKNOWLEDGED", "RESOLVED"]).optional(),
  machineId: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional().default(20)
});

const AcknowledgeAlertSchema = z.object({
  alertId: z.string().min(1),
  note: z.string().max(400).optional()
});

const PublishNotificationSchema = z.object({
  topicId: z.string().min(1).default("topic-plant-alerts"),
  subject: z.string().min(1).max(160),
  message: z.string().min(1).max(1000),
  severity: z.enum(["info", "warning", "high", "critical"]).optional().default("info")
});

const InspectQueuesSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(20)
});

const ExecuteConnectorCodeSchema = z.object({
  code: z.string().min(1).max(4000),
  input: z.record(z.string(), z.unknown()).optional()
});

const paasTools: ConnectorToolDefinition[] = [
  {
    name: "paas.list_workflows",
    description: "List automation workflows configured in Kojo for the caller's tenant.",
    inputSchema: ListWorkflowsSchema,
    requiredPermission: "workflow:read",
    access: "read",
    toolkit: "paas",
    riskLevel: "low",
    connectorKind: "paas",
    execute: async (rawArgs, ctx) => {
      const args = ListWorkflowsSchema.parse(rawArgs);
      const conds = [eq(workflows.tenantId, ctx.user.tenantId)];
      if (args.enabledOnly) conds.push(eq(workflows.enabled, true));

      const rows = await ctx.db
        .select({
          id: workflows.id,
          name: workflows.name,
          description: workflows.description,
          triggerType: workflows.triggerType,
          enabled: workflows.enabled,
          currentVersion: workflows.currentVersion,
          updatedAt: workflows.updatedAt
        })
        .from(workflows)
        .where(and(...conds))
        .orderBy(desc(workflows.updatedAt))
        .limit(51);

      const bounded = boundRows(rows, args.limit);
      return {
        workflows: bounded.rows,
        truncated: bounded.truncated
      };
    }
  },
  {
    name: "paas.trigger_workflow",
    description: "Execute a workflow manually by ID (requires confirmation).",
    inputSchema: TriggerWorkflowSchema,
    requiredPermission: "workflow:execute",
    access: "write",
    toolkit: "paas",
    riskLevel: "medium",
    connectorKind: "paas",
    execute: async (rawArgs, ctx) => {
      const args = TriggerWorkflowSchema.parse(rawArgs);
      const run = await executeWorkflow(ctx.db, {
        tenantId: ctx.user.tenantId,
        workflowId: args.workflowId,
        triggerSource: "chat",
        triggeredBy: ctx.user.userId,
        input: args.input,
        allowedPlantIds: ctx.user.plantIds
      });
      return {
        executed: true,
        runId: run.id,
        status: run.status,
        stepTraces: run.stepTraces
      };
    }
  },
  {
    name: "paas.list_alerts",
    description: "List Kojo alert rules and alert events scoped to authorized plants.",
    inputSchema: ListAlertsSchema,
    requiredPermission: "alert:read",
    access: "read",
    toolkit: "paas",
    riskLevel: "low",
    connectorKind: "paas",
    execute: async (rawArgs, ctx) => {
      const args = ListAlertsSchema.parse(rawArgs);
      const plantCond =
        ctx.user.plantIds.length > 0
          ? or(
              isNull(alertEvents.plantId),
              inArray(alertEvents.plantId, ctx.user.plantIds)
            )
          : isNull(alertEvents.plantId);

      const conds = [eq(alertEvents.tenantId, ctx.user.tenantId), plantCond!];
      if (args.status) conds.push(eq(alertEvents.status, args.status));
      if (args.machineId) conds.push(eq(alertEvents.machineId, args.machineId));

      const [events, rules] = await Promise.all([
        ctx.db
          .select()
          .from(alertEvents)
          .where(and(...conds))
          .orderBy(desc(alertEvents.triggeredAt))
          .limit(args.limit),
        ctx.db
          .select({
            id: alertRules.id,
            name: alertRules.name,
            machineId: alertRules.machineId,
            metricTag: alertRules.metricTag,
            operator: alertRules.operator,
            threshold: alertRules.threshold,
            state: alertRules.state,
            severity: alertRules.severity,
            enabled: alertRules.enabled
          })
          .from(alertRules)
          .where(eq(alertRules.tenantId, ctx.user.tenantId))
          .limit(30)
      ]);

      return { alerts: events, rules };
    }
  },
  {
    name: "paas.acknowledge_alert",
    description: "Acknowledge an active Kojo alert event (requires confirmation).",
    inputSchema: AcknowledgeAlertSchema,
    requiredPermission: "alert:acknowledge",
    access: "write",
    toolkit: "paas",
    riskLevel: "medium",
    connectorKind: "paas",
    execute: async (rawArgs, ctx) => {
      const args = AcknowledgeAlertSchema.parse(rawArgs);
      const rows = await ctx.db
        .select()
        .from(alertEvents)
        .where(
          and(
            eq(alertEvents.id, args.alertId),
            eq(alertEvents.tenantId, ctx.user.tenantId)
          )
        )
        .limit(1);

      const alert = rows[0];
      if (!alert) {
        throw new Error(`Alert '${args.alertId}' not found.`);
      }
      if (alert.plantId && !ctx.user.plantIds.includes(alert.plantId)) {
        throw new Error("Alert belongs to a plant outside your scope.");
      }

      const now = new Date();
      await ctx.db
        .update(alertEvents)
        .set({
          status: "ACKNOWLEDGED",
          acknowledgedBy: ctx.user.email,
          acknowledgedAt: now
        })
        .where(eq(alertEvents.id, alert.id));

      return {
        acknowledged: true,
        alertId: alert.id,
        status: "ACKNOWLEDGED",
        acknowledgedBy: ctx.user.email
      };
    }
  },
  {
    name: "paas.publish_notification",
    description: "Publish a Kojo topic notification across subscribed channels (requires confirmation).",
    inputSchema: PublishNotificationSchema,
    requiredPermission: "notification:write",
    access: "write",
    toolkit: "paas",
    riskLevel: "medium",
    connectorKind: "paas",
    execute: async (rawArgs, ctx) => {
      const args = PublishNotificationSchema.parse(rawArgs);
      const res = await publishToTopic(ctx.db, ctx.user.tenantId, args.topicId, {
        subject: args.subject,
        message: args.message,
        severity: args.severity
      });
      return { ...res };
    }
  },
  {
    name: "paas.inspect_queues",
    description: "Inspect Kojo dispatch queues and notification topics for the tenant.",
    inputSchema: InspectQueuesSchema,
    requiredPermission: "queue:read",
    access: "read",
    toolkit: "paas",
    riskLevel: "low",
    connectorKind: "paas",
    execute: async (rawArgs, ctx) => {
      const args = InspectQueuesSchema.parse(rawArgs);
      const [queueSummaries, topicRows] = await Promise.all([
        listQueueSummaries(ctx.db, ctx.user.tenantId),
        ctx.db
          .select()
          .from(topics)
          .where(eq(topics.tenantId, ctx.user.tenantId))
          .limit(args.limit)
      ]);
      return {
        queues: queueSummaries.slice(0, args.limit),
        topics: topicRows
      };
    }
  },
  {
    name: "execute_connector_code",
    description:
      "Execute a multi-tool script in an isolated child process using Kojo Connector Protocol (UTCP + MCP) with parent policy enforcement.",
    inputSchema: ExecuteConnectorCodeSchema,
    requiredPermission: "connector:read",
    access: "read",
    toolkit: "paas",
    riskLevel: "low",
    connectorKind: "paas",
    execute: async () => {
      throw new Error(
        "execute_connector_code must run through the isolated Kojo Code Mode supervisor."
      );
    }
  }
];

export const paasConnector: Connector = {
  id: "connector-paas",
  kind: "paas",
  name: "Kojo PaaS Control Plane",
  credentialSchema: PaasCredentialSchema,
  async healthCheck(db: KojoDatabase, tenantId: string): Promise<ConnectorHealth> {
    const start = Date.now();
    await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(eq(workflows.tenantId, tenantId))
      .limit(1);
    return {
      id: "connector-paas",
      kind: "paas",
      status: "healthy",
      latencyMs: Date.now() - start,
      message: "Workflows, alerts, topics, and queues ready"
    };
  },
  listTools: () => paasTools,
  createMcpServer: () => buildConnectorMcpServer("paas", paasTools)
};
