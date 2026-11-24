import crypto from "node:crypto";
import { z } from "zod";
import {
  alarms,
  and,
  assets,
  desc,
  eq,
  faultCodes,
  inArray,
  workOrders,
  type LuticDatabase
} from "@lutic/core";
import {
  boundRows,
  buildConnectorMcpServer,
  type Connector,
  type ConnectorHealth,
  type ConnectorToolDefinition
} from "../types";

const CmmsCredentialSchema = z.object({
  endpoint: z.string().min(1).default("mock://cmms.local"),
  apiKey: z.string().min(1).default("cmms-demo-key"),
  plantCode: z.string().default("DET-01")
});

const GetWorkOrdersSchema = z.object({
  machineId: z.string().optional(),
  plantId: z.string().optional(),
  status: z.enum(["open", "in_progress", "completed", "draft"]).optional(),
  faultCode: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional().default(20)
});

const GetMachineHistorySchema = z.object({
  machineId: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional().default(15)
});

const FindSimilarFaultsSchema = z.object({
  faultCode: z.string().optional(),
  machineType: z.string().optional(),
  keywords: z.string().optional(),
  limit: z.number().int().min(1).max(20).optional().default(10)
});

const DraftWorkOrderSchema = z.object({
  machineId: z.string().min(1),
  type: z.enum(["corrective", "preventive", "inspection"]).default("corrective"),
  priority: z.enum(["urgent", "high", "medium", "low"]).default("high"),
  faultCode: z.string().optional().default(""),
  description: z.string().min(5).max(1000)
});

const cmmsTools: ConnectorToolDefinition[] = [
  {
    name: "get_work_orders",
    description: "List maintenance work orders scoped to the user's authorized plants (max 50 rows).",
    inputSchema: GetWorkOrdersSchema,
    requiredPermission: "workorder:read",
    access: "read",
    toolkit: "maintenance",
    riskLevel: "low",
    connectorKind: "cmms",
    execute: async (rawArgs, ctx) => {
      const args = GetWorkOrdersSchema.parse(rawArgs);
      const plantIds = args.plantId ? [args.plantId] : ctx.user.plantIds;
      const conds = [
        eq(workOrders.tenantId, ctx.user.tenantId),
        inArray(workOrders.plantId, plantIds)
      ];
      if (args.machineId) conds.push(eq(workOrders.machineId, args.machineId));
      if (args.status) conds.push(eq(workOrders.status, args.status));
      if (args.faultCode) conds.push(eq(workOrders.faultCode, args.faultCode));

      const rows = await ctx.db
        .select({
          id: workOrders.id,
          machineId: workOrders.machineId,
          machineName: assets.name,
          plantId: workOrders.plantId,
          type: workOrders.type,
          priority: workOrders.priority,
          status: workOrders.status,
          faultCode: workOrders.faultCode,
          description: workOrders.description,
          resolution: workOrders.resolution,
          partsUsed: workOrders.partsUsed,
          openedAt: workOrders.openedAt,
          closedAt: workOrders.closedAt,
          technician: workOrders.technician
        })
        .from(workOrders)
        .innerJoin(assets, eq(assets.id, workOrders.machineId))
        .where(and(...conds))
        .orderBy(desc(workOrders.openedAt))
        .limit(51);

      const bounded = boundRows(rows, args.limit);
      return {
        workOrders: bounded.rows,
        truncated: bounded.truncated,
        truncationNote: bounded.truncationNote
      };
    }
  },
  {
    name: "get_machine_history",
    description: "Get combined recent repair work orders and historical alarms for a specific machine.",
    inputSchema: GetMachineHistorySchema,
    requiredPermission: "workorder:read",
    access: "read",
    toolkit: "maintenance",
    riskLevel: "low",
    connectorKind: "cmms",
    execute: async (rawArgs, ctx) => {
      const args = GetMachineHistorySchema.parse(rawArgs);
      const orders = await ctx.db
        .select()
        .from(workOrders)
        .where(
          and(
            eq(workOrders.tenantId, ctx.user.tenantId),
            eq(workOrders.machineId, args.machineId),
            inArray(workOrders.plantId, ctx.user.plantIds)
          )
        )
        .orderBy(desc(workOrders.openedAt))
        .limit(args.limit);

      const recentAlarms = await ctx.db
        .select()
        .from(alarms)
        .where(
          and(
            eq(alarms.tenantId, ctx.user.tenantId),
            eq(alarms.machineId, args.machineId),
            inArray(alarms.plantId, ctx.user.plantIds)
          )
        )
        .orderBy(desc(alarms.raisedAt))
        .limit(args.limit);

      return {
        machineId: args.machineId,
        workOrders: orders,
        alarms: recentAlarms
      };
    }
  },
  {
    name: "find_similar_faults",
    description: "Find historical resolved work orders and ISO failure modes matching a fault code or symptoms.",
    inputSchema: FindSimilarFaultsSchema,
    requiredPermission: "workorder:read",
    access: "read",
    toolkit: "maintenance",
    riskLevel: "low",
    connectorKind: "cmms",
    execute: async (rawArgs, ctx) => {
      const args = FindSimilarFaultsSchema.parse(rawArgs);
      const conds = [
        eq(workOrders.tenantId, ctx.user.tenantId),
        inArray(workOrders.plantId, ctx.user.plantIds),
        eq(workOrders.status, "completed")
      ];
      if (args.faultCode) {
        conds.push(eq(workOrders.faultCode, args.faultCode));
      }

      const orders = await ctx.db
        .select({
          id: workOrders.id,
          machineId: workOrders.machineId,
          machineName: assets.name,
          machineType: assets.machineType,
          status: workOrders.status,
          faultCode: workOrders.faultCode,
          description: workOrders.description,
          resolution: workOrders.resolution,
          partsUsed: workOrders.partsUsed,
          closedAt: workOrders.closedAt,
          technician: workOrders.technician
        })
        .from(workOrders)
        .innerJoin(assets, eq(assets.id, workOrders.machineId))
        .where(and(...conds))
        .orderBy(desc(workOrders.closedAt))
        .limit(50);

      const filtered = orders.filter((o) => {
        if (args.machineType && o.machineType !== args.machineType) return false;
        if (args.keywords) {
          const kw = args.keywords.toLowerCase();
          const hay = `${o.description} ${o.resolution} ${o.faultCode}`.toLowerCase();
          return hay.includes(kw);
        }
        return true;
      });

      const taxonomy = args.faultCode
        ? await ctx.db
            .select()
            .from(faultCodes)
            .where(
              and(
                eq(faultCodes.tenantId, ctx.user.tenantId),
                eq(faultCodes.code, args.faultCode)
              )
            )
            .limit(5)
        : [];

      const bounded = boundRows(filtered, args.limit);
      return {
        taxonomy,
        similarRepairs: bounded.rows,
        truncated: bounded.truncated
      };
    }
  },
  {
    name: "draft_work_order",
    description:
      "Create a maintenance work order in the CMMS. Requires explicit user confirmation and idempotency key enforced by the Policy Engine.",
    inputSchema: DraftWorkOrderSchema,
    requiredPermission: "workorder:write",
    access: "write",
    toolkit: "action",
    riskLevel: "high",
    connectorKind: "cmms",
    execute: async (rawArgs, ctx) => {
      const args = DraftWorkOrderSchema.parse(rawArgs);
      if (!ctx.confirmationId || !ctx.idempotencyKey) {
        throw new Error(
          "Write execution denied: confirmationId and idempotencyKey are required."
        );
      }

      const machineRows = await ctx.db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, args.machineId),
            eq(assets.tenantId, ctx.user.tenantId),
            inArray(assets.plantId, ctx.user.plantIds)
          )
        )
        .limit(1);

      const machine = machineRows[0];
      if (!machine) {
        throw new Error("Machine not found in authorized plant scope.");
      }

      // Idempotency check
      const existing = await ctx.db
        .select()
        .from(workOrders)
        .where(
          and(
            eq(workOrders.tenantId, ctx.user.tenantId),
            eq(workOrders.idempotencyKey, ctx.idempotencyKey)
          )
        )
        .limit(1);

      if (existing[0]) {
        return {
          created: false,
          idempotentReplay: true,
          workOrder: existing[0]
        };
      }

      const id = `wo-${crypto.randomUUID().slice(0, 8)}`;
      const inserted = {
        id,
        tenantId: ctx.user.tenantId,
        plantId: machine.plantId,
        machineId: machine.id,
        componentId: null,
        type: args.type,
        priority: args.priority,
        status: "open" as const,
        faultCode: args.faultCode ?? "",
        description: args.description,
        resolution: "",
        partsUsed: [],
        openedAt: new Date(),
        closedAt: null,
        technician: ctx.user.name,
        idempotencyKey: ctx.idempotencyKey
      };

      await ctx.db.insert(workOrders).values(inserted);
      return {
        created: true,
        idempotentReplay: false,
        workOrder: inserted
      };
    }
  }
];

export const cmmsConnector: Connector = {
  id: "connector-cmms",
  kind: "cmms",
  name: "Lutic CMMS Connector",
  credentialSchema: CmmsCredentialSchema,
  async healthCheck(db: LuticDatabase, tenantId: string): Promise<ConnectorHealth> {
    const start = Date.now();
    await db
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(eq(workOrders.tenantId, tenantId))
      .limit(1);
    return {
      id: "connector-cmms",
      kind: "cmms",
      status: "healthy",
      latencyMs: Date.now() - start,
      message: "CMMS work orders & fault taxonomy synced"
    };
  },
  listTools: () => cmmsTools,
  createMcpServer: () => buildConnectorMcpServer("cmms", cmmsTools)
};
