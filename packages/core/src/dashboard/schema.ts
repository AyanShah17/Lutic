import { z } from "zod";
import { ROLES } from "../rbac";

export const WidgetTypeSchema = z.enum([
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
]);
export type WidgetType = z.infer<typeof WidgetTypeSchema>;

export const TimeRangeSchema = z.enum(["shift", "24h", "7d", "30d", "90d"]);
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const SemanticDimensionSchema = z.enum([
  "machine",
  "line",
  "plant",
  "shift",
  "day",
  "week",
  "reason_code",
  "defect_type"
]);
export type SemanticDimension = z.infer<typeof SemanticDimensionSchema>;

export const WidgetFiltersSchema = z
  .object({
    plantId: z.string().optional(),
    lineId: z.string().optional(),
    machineId: z.string().optional(),
    shift: z.enum(["A", "B", "C"]).optional()
  })
  .default({});

export const DashboardWidgetSchema = z.object({
  id: z.string().min(1),
  type: WidgetTypeSchema,
  title: z.string().min(1).max(120),
  description: z.string().max(400).optional(),
  metric: z.string().optional(),
  groupBy: SemanticDimensionSchema.optional(),
  filters: WidgetFiltersSchema.optional(),
  range: TimeRangeSchema.optional().default("7d"),
  compareTo: z.enum(["previous_period", "target"]).optional(),
  sort: z.enum(["asc", "desc"]).optional().default("desc"),
  limit: z.number().int().min(1).max(50).optional().default(12),
  target: z.number().optional(),
  content: z.string().max(4000).optional()
});

export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>;

export const DashboardLayoutItemSchema = z.object({
  i: z.string().min(1),
  x: z.number().int().min(0).max(24),
  y: z.number().int().min(0).max(200),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20)
});
export type DashboardLayoutItem = z.infer<typeof DashboardLayoutItemSchema>;

export const DashboardSpecSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(140),
  description: z.string().max(500).default(""),
  plantScope: z.array(z.string()).default([]),
  filters: z
    .object({
      range: TimeRangeSchema.default("7d"),
      plantId: z.string().optional(),
      lineId: z.string().optional()
    })
    .default({ range: "7d" }),
  widgets: z.array(DashboardWidgetSchema).min(1).max(24),
  layout: z.array(DashboardLayoutItemSchema),
  version: z.number().int().min(1).default(1)
});

export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;

export const DashboardShareRequestSchema = z.object({
  shares: z.array(
    z.object({
      shareType: z.enum(["role", "plant"]),
      targetId: z.string().min(1)
    })
  )
});

export const RoleTargetSchema = z.enum(ROLES);
