import { z } from "zod";
import {
  alarms,
  and,
  assets,
  desc,
  eq,
  inArray,
  isNull,
  machineStatus,
  PostgresTimeSeriesStore,
  type KojoDatabase
} from "@kojo/core";
import {
  boundRows,
  buildConnectorMcpServer,
  type Connector,
  type ConnectorHealth,
  type ConnectorToolDefinition
} from "../types";

const HistorianCredentialSchema = z.object({
  endpoint: z.string().min(1).default("mock://historian.local"),
  token: z.string().min(1).default("historian-demo-token"),
  pollIntervalSec: z.coerce.number().int().min(1).max(300).default(5)
});

const ListMachinesSchema = z.object({
  plantId: z.string().optional(),
  lineId: z.string().optional(),
  machineType: z.string().optional(),
  status: z.enum(["running", "idle", "fault", "offline"]).optional(),
  limit: z.number().int().min(1).max(50).optional().default(50)
});

const MachineIdSchema = z.object({
  machineId: z.string().min(1)
});

const GetActiveAlarmsSchema = z.object({
  plantId: z.string().optional(),
  machineId: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional().default(25)
});

const GetAlarmHistorySchema = z.object({
  machineId: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional().default(20)
});

const GetRecentReadingsSchema = z.object({
  machineId: z.string().min(1),
  tag: z.enum(["vibration", "temperature", "pressure", "current", "speed"]).optional(),
  hours: z.number().int().min(1).max(24 * 30).optional().default(24),
  bucketMinutes: z.number().int().min(5).max(1440).optional()
});

const historianTools: ConnectorToolDefinition[] = [
  {
    name: "list_machines",
    description: "List machines visible within the user's authorized plants with live status.",
    inputSchema: ListMachinesSchema,
    requiredPermission: "machine:read",
    access: "read",
    toolkit: "machine",
    riskLevel: "low",
    connectorKind: "historian",
    execute: async (rawArgs, ctx) => {
      const args = ListMachinesSchema.parse(rawArgs);
      const plantIds = args.plantId ? [args.plantId] : ctx.user.plantIds;
      if (plantIds.length === 0) return { machines: [], truncated: false };

      const rows = await ctx.db
        .select({
          id: assets.id,
          name: assets.name,
          plantId: assets.plantId,
          lineId: assets.parentId,
          machineType: assets.machineType,
          manufacturer: assets.manufacturer,
          model: assets.model,
          criticality: assets.criticality,
          status: machineStatus.status,
          temperature: machineStatus.temperature,
          vibration: machineStatus.vibration
        })
        .from(assets)
        .leftJoin(machineStatus, eq(machineStatus.machineId, assets.id))
        .where(
          and(
            eq(assets.tenantId, ctx.user.tenantId),
            eq(assets.type, "machine"),
            inArray(assets.plantId, plantIds)
          )
        );

      const filtered = rows.filter((r) => {
        if (args.lineId && r.lineId !== args.lineId) return false;
        if (args.machineType && r.machineType !== args.machineType) return false;
        if (args.status && r.status !== args.status) return false;
        return true;
      });

      const bounded = boundRows(filtered, args.limit);
      return {
        machines: bounded.rows,
        truncated: bounded.truncated,
        truncationNote: bounded.truncationNote
      };
    }
  },
  {
    name: "get_machine",
    description: "Get asset metadata, manufacturer, model, criticality, and QR link for a machine.",
    inputSchema: MachineIdSchema,
    requiredPermission: "machine:read",
    access: "read",
    toolkit: "machine",
    riskLevel: "low",
    connectorKind: "historian",
    execute: async (rawArgs, ctx) => {
      const args = MachineIdSchema.parse(rawArgs);
      const rows = await ctx.db
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

      const machine = rows[0];
      if (!machine) {
        return { found: false, message: "Machine not found in authorized plant scope." };
      }

      const components = await ctx.db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.parentId, machine.id),
            eq(assets.tenantId, ctx.user.tenantId)
          )
        )
        .limit(20);

      return { found: true, machine, components };
    }
  },
  {
    name: "get_machine_status",
    description: "Get current operational status (running, idle, fault, offline) and latest sensor snapshot for a machine.",
    inputSchema: MachineIdSchema,
    requiredPermission: "machine:read",
    access: "read",
    toolkit: "machine",
    riskLevel: "low",
    connectorKind: "historian",
    execute: async (rawArgs, ctx) => {
      const args = MachineIdSchema.parse(rawArgs);
      const rows = await ctx.db
        .select({
          machineId: machineStatus.machineId,
          machineName: assets.name,
          machineType: assets.machineType,
          plantId: machineStatus.plantId,
          status: machineStatus.status,
          currentSpeed: machineStatus.currentSpeed,
          temperature: machineStatus.temperature,
          vibration: machineStatus.vibration,
          pressure: machineStatus.pressure,
          updatedAt: machineStatus.updatedAt
        })
        .from(machineStatus)
        .innerJoin(assets, eq(assets.id, machineStatus.machineId))
        .where(
          and(
            eq(machineStatus.machineId, args.machineId),
            eq(machineStatus.tenantId, ctx.user.tenantId),
            inArray(machineStatus.plantId, ctx.user.plantIds)
          )
        )
        .limit(1);

      if (!rows[0]) {
        return { found: false, message: "Machine status not found in authorized plant scope." };
      }
      return { found: true, status: rows[0] };
    }
  },
  {
    name: "get_active_alarms",
    description: "Get currently active (uncleared) alarms for a machine or across authorized plants.",
    inputSchema: GetActiveAlarmsSchema,
    requiredPermission: "machine:read",
    access: "read",
    toolkit: "machine",
    riskLevel: "low",
    connectorKind: "historian",
    execute: async (rawArgs, ctx) => {
      const args = GetActiveAlarmsSchema.parse(rawArgs);
      const plantIds = args.plantId ? [args.plantId] : ctx.user.plantIds;
      const conds = [
        eq(alarms.tenantId, ctx.user.tenantId),
        inArray(alarms.plantId, plantIds),
        isNull(alarms.clearedAt)
      ];
      if (args.machineId) {
        conds.push(eq(alarms.machineId, args.machineId));
      }

      const rows = await ctx.db
        .select({
          id: alarms.id,
          machineId: alarms.machineId,
          machineName: assets.name,
          machineType: assets.machineType,
          plantId: alarms.plantId,
          code: alarms.code,
          severity: alarms.severity,
          message: alarms.message,
          raisedAt: alarms.raisedAt
        })
        .from(alarms)
        .innerJoin(assets, eq(assets.id, alarms.machineId))
        .where(and(...conds))
        .orderBy(desc(alarms.raisedAt))
        .limit(51);

      const bounded = boundRows(rows, args.limit);
      return {
        alarms: bounded.rows,
        truncated: bounded.truncated,
        truncationNote: bounded.truncationNote
      };
    }
  },
  {
    name: "get_alarm_history",
    description: "Get historical alarms (cleared and active) for a machine (max 50 rows).",
    inputSchema: GetAlarmHistorySchema,
    requiredPermission: "machine:read",
    access: "read",
    toolkit: "machine",
    riskLevel: "low",
    connectorKind: "historian",
    execute: async (rawArgs, ctx) => {
      const args = GetAlarmHistorySchema.parse(rawArgs);
      const rows = await ctx.db
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
        .limit(51);

      const bounded = boundRows(rows, args.limit);
      return {
        alarms: bounded.rows,
        truncated: bounded.truncated,
        truncationNote: bounded.truncationNote
      };
    }
  },
  {
    name: "get_recent_readings",
    description:
      "Get date_bin aggregated sensor readings (avg, min, max, count) for a machine. Raw sensor streams are never returned.",
    inputSchema: GetRecentReadingsSchema,
    requiredPermission: "machine:read",
    access: "read",
    toolkit: "machine",
    riskLevel: "low",
    connectorKind: "historian",
    execute: async (rawArgs, ctx) => {
      const args = GetRecentReadingsSchema.parse(rawArgs);
      // Confirm machine belongs to user's authorized plants
      const mRows = await ctx.db
        .select({ id: assets.id, name: assets.name })
        .from(assets)
        .where(
          and(
            eq(assets.id, args.machineId),
            eq(assets.tenantId, ctx.user.tenantId),
            inArray(assets.plantId, ctx.user.plantIds)
          )
        )
        .limit(1);

      if (!mRows[0]) {
        return { found: false, buckets: [], message: "Machine not in authorized scope." };
      }

      const store = new PostgresTimeSeriesStore(ctx.db);
      const agg = await store.queryAggregatedReadings({
        tenantId: ctx.user.tenantId,
        machineId: args.machineId,
        tag: args.tag,
        hours: args.hours,
        bucketMinutes: args.bucketMinutes,
        maxBuckets: 50
      });

      return {
        found: true,
        machineId: args.machineId,
        machineName: mRows[0].name,
        aggregatedOnly: true,
        buckets: agg.buckets,
        truncated: agg.truncated
      };
    }
  }
];

export const historianConnector: Connector = {
  id: "connector-historian",
  kind: "historian",
  name: "Mock Historian / SCADA",
  credentialSchema: HistorianCredentialSchema,
  async healthCheck(db: KojoDatabase, tenantId: string): Promise<ConnectorHealth> {
    const start = Date.now();
    await db
      .select({ id: machineStatus.id })
      .from(machineStatus)
      .where(eq(machineStatus.tenantId, tenantId))
      .limit(1);
    return {
      id: "connector-historian",
      kind: "historian",
      status: "healthy",
      latencyMs: Date.now() - start,
      message: "Historian time-series & alarm stream connected"
    };
  },
  listTools: () => historianTools,
  createMcpServer: () => buildConnectorMcpServer("historian", historianTools)
};
