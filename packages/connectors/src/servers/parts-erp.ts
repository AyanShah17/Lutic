import { z } from "zod";
import {
  and,
  eq,
  inArray,
  inventory,
  parts,
  pendingActions,
  plants,
  sql,
  type KojoDatabase
} from "@kojo/core";
import {
  boundRows,
  buildConnectorMcpServer,
  type Connector,
  type ConnectorHealth,
  type ConnectorToolDefinition
} from "../types";

const PartsErpCredentialSchema = z.object({
  endpoint: z.string().min(1).default("mock://parts-erp.local"),
  clientId: z.string().min(1).default("kojo-erp"),
  clientSecret: z.string().min(1).default("erp-demo-secret")
});

const GetPartsInventorySchema = z.object({
  plantId: z.string().optional(),
  partNo: z.string().optional(),
  lowStockOnly: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(50).optional().default(30)
});

const FindPartForFaultSchema = z.object({
  faultCode: z.string().optional(),
  machineType: z.string().optional(),
  query: z.string().optional(),
  plantId: z.string().optional()
});

const ReservePartSchema = z.object({
  partNo: z.string().min(1),
  plantId: z.string().optional(),
  quantity: z.number().int().min(1).max(20).default(1),
  workOrderId: z.string().optional(),
  reason: z.string().min(3).max(400).default("Maintenance repair")
});

const FAULT_PART_HINTS: Record<string, string[]> = {
  E42: ["PRT-SV-402", "PRT-VAL-118"],
  E45: ["PRT-VAL-118"],
  F104: ["PRT-BRG-204", "PRT-SEN-310"],
  H22: ["PRT-FLT-091"],
  P08: ["PRT-SEP-501"],
  R15: ["PRT-LCK-602"],
  S31: ["PRT-CLM-710"],
  C07: ["PRT-SEN-310"]
};

const partsErpTools: ConnectorToolDefinition[] = [
  {
    name: "get_parts_inventory",
    description:
      "Check spare parts stock on hand, reserved count, available count, crib location, and lead time scoped to authorized plants.",
    inputSchema: GetPartsInventorySchema,
    requiredPermission: "parts:read",
    access: "read",
    toolkit: "maintenance",
    riskLevel: "low",
    connectorKind: "parts-erp",
    execute: async (rawArgs, ctx) => {
      const args = GetPartsInventorySchema.parse(rawArgs);
      const plantIds = args.plantId ? [args.plantId] : ctx.user.plantIds;
      const conds = [
        eq(inventory.tenantId, ctx.user.tenantId),
        inArray(inventory.plantId, plantIds)
      ];
      if (args.partNo) {
        conds.push(eq(parts.partNo, args.partNo));
      }

      const rows = await ctx.db
        .select({
          partId: parts.id,
          partNo: parts.partNo,
          description: parts.description,
          compatibleMachineTypes: parts.compatibleMachineTypes,
          unitCostUsd: parts.unitCostUsd,
          plantId: inventory.plantId,
          plantName: plants.name,
          onHand: inventory.onHand,
          reserved: inventory.reserved,
          minLevel: inventory.minLevel,
          location: inventory.location,
          leadTimeDays: inventory.leadTimeDays
        })
        .from(inventory)
        .innerJoin(parts, eq(parts.id, inventory.partId))
        .innerJoin(plants, eq(plants.id, inventory.plantId))
        .where(and(...conds));

      const enriched = rows
        .map((r) => ({
          ...r,
          available: Math.max(0, r.onHand - r.reserved),
          belowMinStock: r.onHand - r.reserved < r.minLevel
        }))
        .filter((r) => (!args.lowStockOnly ? true : r.belowMinStock));

      const bounded = boundRows(enriched, args.limit);
      return {
        inventory: bounded.rows,
        truncated: bounded.truncated,
        truncationNote: bounded.truncationNote
      };
    }
  },
  {
    name: "find_part_for_fault",
    description:
      "Find spare parts associated with a fault code, machine type, or keyword, including current crib stock in the user's plants.",
    inputSchema: FindPartForFaultSchema,
    requiredPermission: "parts:read",
    access: "read",
    toolkit: "maintenance",
    riskLevel: "low",
    connectorKind: "parts-erp",
    execute: async (rawArgs, ctx) => {
      const args = FindPartForFaultSchema.parse(rawArgs);
      const plantIds = args.plantId ? [args.plantId] : ctx.user.plantIds;
      const hintParts = args.faultCode
        ? FAULT_PART_HINTS[args.faultCode.toUpperCase()] ?? []
        : [];

      const rows = await ctx.db
        .select({
          partId: parts.id,
          partNo: parts.partNo,
          description: parts.description,
          compatibleMachineTypes: parts.compatibleMachineTypes,
          unitCostUsd: parts.unitCostUsd,
          plantId: inventory.plantId,
          onHand: inventory.onHand,
          reserved: inventory.reserved,
          minLevel: inventory.minLevel,
          location: inventory.location,
          leadTimeDays: inventory.leadTimeDays
        })
        .from(inventory)
        .innerJoin(parts, eq(parts.id, inventory.partId))
        .where(
          and(
            eq(inventory.tenantId, ctx.user.tenantId),
            inArray(inventory.plantId, plantIds)
          )
        );

      const matched = rows.filter((r) => {
        if (hintParts.length > 0 && hintParts.includes(r.partNo)) return true;
        if (
          args.machineType &&
          Array.isArray(r.compatibleMachineTypes) &&
          r.compatibleMachineTypes.includes(args.machineType)
        ) {
          return true;
        }
        if (args.query) {
          const q = args.query.toLowerCase();
          return (
            r.partNo.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q)
          );
        }
        return hintParts.length === 0 && !args.machineType && !args.query;
      });

      const bounded = boundRows(
        matched.map((r) => ({
          ...r,
          available: Math.max(0, r.onHand - r.reserved)
        })),
        25
      );

      return {
        faultCode: args.faultCode ?? null,
        parts: bounded.rows,
        truncated: bounded.truncated
      };
    }
  },
  {
    name: "reserve_part",
    description:
      "Reserve spare parts in plant crib inventory. Requires explicit user confirmation and idempotency key enforced by the Policy Engine.",
    inputSchema: ReservePartSchema,
    requiredPermission: "parts:write",
    access: "write",
    toolkit: "action",
    riskLevel: "high",
    connectorKind: "parts-erp",
    execute: async (rawArgs, ctx) => {
      const args = ReservePartSchema.parse(rawArgs);
      if (!ctx.confirmationId || !ctx.idempotencyKey) {
        throw new Error(
          "Write execution denied: confirmationId and idempotencyKey are required."
        );
      }

      const targetPlantId = args.plantId ?? ctx.user.plantIds[0];
      if (!targetPlantId || !ctx.user.plantIds.includes(targetPlantId)) {
        throw new Error("Target plant is outside user's authorized plant scope.");
      }

      // Check idempotency if already executed
      const existingAction = await ctx.db
        .select()
        .from(pendingActions)
        .where(
          and(
            eq(pendingActions.tenantId, ctx.user.tenantId),
            eq(pendingActions.idempotencyKey, ctx.idempotencyKey),
            eq(pendingActions.status, "executed")
          )
        )
        .limit(1);

      if (existingAction[0]?.result) {
        return {
          reserved: false,
          idempotentReplay: true,
          ...existingAction[0].result
        };
      }

      const partRows = await ctx.db
        .select()
        .from(parts)
        .where(
          and(
            eq(parts.tenantId, ctx.user.tenantId),
            eq(parts.partNo, args.partNo)
          )
        )
        .limit(1);

      const part = partRows[0];
      if (!part) {
        throw new Error(`Part '${args.partNo}' not found.`);
      }

      const invRows = await ctx.db
        .select()
        .from(inventory)
        .where(
          and(
            eq(inventory.tenantId, ctx.user.tenantId),
            eq(inventory.partId, part.id),
            eq(inventory.plantId, targetPlantId)
          )
        )
        .limit(1);

      const inv = invRows[0];
      if (!inv) {
        throw new Error(`No inventory record for ${args.partNo} at ${targetPlantId}.`);
      }

      const available = inv.onHand - inv.reserved;
      if (available < args.quantity) {
        throw new Error(
          `Insufficient available stock for ${args.partNo} at ${targetPlantId} (available: ${available}, requested: ${args.quantity}).`
        );
      }

      await ctx.db
        .update(inventory)
        .set({ reserved: sql`${inventory.reserved} + ${args.quantity}` })
        .where(eq(inventory.id, inv.id));

      return {
        reserved: true,
        idempotentReplay: false,
        partNo: part.partNo,
        description: part.description,
        plantId: targetPlantId,
        quantityReserved: args.quantity,
        newReservedTotal: inv.reserved + args.quantity,
        remainingAvailable: available - args.quantity,
        location: inv.location
      };
    }
  }
];

export const partsErpConnector: Connector = {
  id: "connector-parts-erp",
  kind: "parts-erp",
  name: "Mock Spare Parts ERP",
  credentialSchema: PartsErpCredentialSchema,
  async healthCheck(db: KojoDatabase, tenantId: string): Promise<ConnectorHealth> {
    const start = Date.now();
    await db
      .select({ id: parts.id })
      .from(parts)
      .where(eq(parts.tenantId, tenantId))
      .limit(1);
    return {
      id: "connector-parts-erp",
      kind: "parts-erp",
      status: "healthy",
      latencyMs: Date.now() - start,
      message: "Parts catalog and plant crib inventory synchronized"
    };
  },
  listTools: () => partsErpTools,
  createMcpServer: () => buildConnectorMcpServer("parts-erp", partsErpTools)
};
