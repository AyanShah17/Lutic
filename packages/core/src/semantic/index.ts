import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { LuticDatabase } from "../db/client";
import { authorize, type SessionUser } from "../rbac";
import {
  SemanticDimensionSchema,
  TimeRangeSchema,
  type SemanticDimension,
  type TimeRange
} from "../dashboard/schema";
import {
  listMetrics,
  METRIC_REGISTRY,
  type MetricDefinition
} from "./registry";

export { listMetrics, METRIC_REGISTRY, type MetricDefinition };

export const MetricQueryInputSchema = z.object({
  metric: z.string().min(1),
  groupBy: SemanticDimensionSchema.optional(),
  range: TimeRangeSchema.default("7d"),
  filters: z
    .object({
      plantId: z.string().optional(),
      lineId: z.string().optional(),
      machineId: z.string().optional(),
      shift: z.enum(["A", "B", "C"]).optional()
    })
    .optional(),
  sort: z.enum(["asc", "desc"]).default("desc"),
  limit: z.number().int().min(1).max(50).default(25),
  compareTo: z.enum(["previous_period", "target"]).optional()
});

export type MetricQueryInput = z.infer<typeof MetricQueryInputSchema>;

export interface MetricDataPoint {
  dimension: string;
  dimensionId?: string;
  value: number;
  previousValue?: number;
  unit: string;
  extra?: Record<string, string | number>;
}

export interface MetricQueryResult {
  metric: MetricDefinition;
  range: TimeRange;
  groupBy?: SemanticDimension;
  summaryValue: number;
  previousSummaryValue?: number;
  rows: MetricDataPoint[];
  truncated: boolean;
  cached: boolean;
  sqlPreview: string;
}

function getRangeHours(range: TimeRange): number {
  switch (range) {
    case "shift":
      return 8;
    case "24h":
      return 24;
    case "7d":
      return 24 * 7;
    case "30d":
      return 24 * 30;
    case "90d":
      return 24 * 90;
  }
}

interface CacheEntry {
  expiresAt: number;
  result: MetricQueryResult;
}

const queryCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15_000;

export function clearMetricCache(): void {
  queryCache.clear();
}

function buildInList(values: string[]): SQL {
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  );
}

function buildDimensionExpr(
  dimension: SemanticDimension | undefined,
  tsColumn: SQL,
  alias: string
): { selectLabel: SQL; selectId: SQL; groupExpr: SQL; joinAssets: boolean; joinLines: boolean; joinPlants: boolean } {
  switch (dimension) {
    case "machine":
      return {
        selectLabel: sql`COALESCE(a.name, ${sql.raw(alias)}.machine_id)`,
        selectId: sql`${sql.raw(alias)}.machine_id`,
        groupExpr: sql`${sql.raw(alias)}.machine_id, a.name`,
        joinAssets: true,
        joinLines: false,
        joinPlants: false
      };
    case "line":
      return {
        selectLabel: sql`COALESCE(ln.name, 'Unassigned Line')`,
        selectId: sql`COALESCE(ln.id, 'unassigned')`,
        groupExpr: sql`ln.id, ln.name`,
        joinAssets: true,
        joinLines: true,
        joinPlants: false
      };
    case "plant":
      return {
        selectLabel: sql`COALESCE(p.name, ${sql.raw(alias)}.plant_id)`,
        selectId: sql`${sql.raw(alias)}.plant_id`,
        groupExpr: sql`${sql.raw(alias)}.plant_id, p.name`,
        joinAssets: false,
        joinLines: false,
        joinPlants: true
      };
    case "shift":
      return {
        selectLabel: sql`'Shift ' || ${sql.raw(alias)}.shift`,
        selectId: sql`${sql.raw(alias)}.shift`,
        groupExpr: sql`${sql.raw(alias)}.shift`,
        joinAssets: false,
        joinLines: false,
        joinPlants: false
      };
    case "day":
      return {
        selectLabel: sql`TO_CHAR(date_trunc('day', ${tsColumn}), 'YYYY-MM-DD')`,
        selectId: sql`TO_CHAR(date_trunc('day', ${tsColumn}), 'YYYY-MM-DD')`,
        groupExpr: sql`date_trunc('day', ${tsColumn})`,
        joinAssets: false,
        joinLines: false,
        joinPlants: false
      };
    case "week":
      return {
        selectLabel: sql`TO_CHAR(date_trunc('week', ${tsColumn}), 'YYYY-MM-DD')`,
        selectId: sql`TO_CHAR(date_trunc('week', ${tsColumn}), 'YYYY-MM-DD')`,
        groupExpr: sql`date_trunc('week', ${tsColumn})`,
        joinAssets: false,
        joinLines: false,
        joinPlants: false
      };
    case "reason_code":
      return {
        selectLabel: sql`${sql.raw(alias)}.reason_code`,
        selectId: sql`${sql.raw(alias)}.reason_code`,
        groupExpr: sql`${sql.raw(alias)}.reason_code`,
        joinAssets: false,
        joinLines: false,
        joinPlants: false
      };
    case "defect_type":
      return {
        selectLabel: sql`${sql.raw(alias)}.defect_type`,
        selectId: sql`${sql.raw(alias)}.defect_type`,
        groupExpr: sql`${sql.raw(alias)}.defect_type`,
        joinAssets: false,
        joinLines: false,
        joinPlants: false
      };
    default:
      return {
        selectLabel: sql`'All Plants'`,
        selectId: sql`'all'`,
        groupExpr: sql`1`,
        joinAssets: false,
        joinLines: false,
        joinPlants: false
      };
  }
}

async function runMetricWindow(
  db: LuticDatabase,
  user: SessionUser,
  metric: MetricDefinition,
  input: MetricQueryInput,
  sinceIso: string,
  untilIso: string,
  scopedPlants: string[]
): Promise<{ rows: MetricDataPoint[]; summaryValue: number; sqlPreview: string }> {
  const filters = input.filters ?? {};
  const limit = Math.min(input.limit ?? 25, 50);
  const sortDir = input.sort === "asc" ? sql`ASC` : sql`DESC`;
  const rangeHours = getRangeHours(input.range);

  // Special case: scrap_rate grouped by defect_type uses quality_events
  if (metric.id === "scrap_rate" && input.groupBy === "defect_type") {
    const lineFilter = filters.lineId
      ? sql`AND a.parent_id = ${filters.lineId}`
      : sql``;
    const machineFilter = filters.machineId
      ? sql`AND q.machine_id = ${filters.machineId}`
      : sql``;
    const rowsRes = await db.execute(sql`
      SELECT
        q.defect_type AS dim_label,
        q.defect_type AS dim_id,
        SUM(q.scrap_count)::double precision AS val
      FROM quality_events q
      LEFT JOIN assets a ON a.id = q.machine_id
      WHERE q.tenant_id = ${user.tenantId}
        AND q.plant_id IN (${buildInList(scopedPlants)})
        AND q.ts >= ${sinceIso}::timestamptz
        AND q.ts < ${untilIso}::timestamptz
        ${lineFilter}
        ${machineFilter}
      GROUP BY q.defect_type
      ORDER BY val ${sortDir}
      LIMIT ${limit + 1}
    `);
    const rows = (rowsRes.rows as Array<{ dim_label: string; dim_id: string; val: number }>)
      .slice(0, limit)
      .map((r) => ({
        dimension: String(r.dim_label),
        dimensionId: String(r.dim_id),
        value: Number(r.val),
        unit: "scrap units"
      }));
    const totalScrap = rows.reduce((s, r) => s + r.value, 0);
    return {
      rows,
      summaryValue: Number(totalScrap.toFixed(2)),
      sqlPreview: `SELECT defect_type, SUM(scrap_count) FROM quality_events WHERE tenant_id = $1 AND plant_id IN (...)`
    };
  }

  // Production runs family
  if (
    ["oee", "availability", "performance", "quality", "scrap_rate", "throughput"].includes(
      metric.id
    )
  ) {
    const dim = buildDimensionExpr(input.groupBy, sql`pr.started_at`, "pr");
    const needAssetJoin = dim.joinAssets || Boolean(filters.lineId);
    const assetJoin = needAssetJoin
      ? sql`LEFT JOIN assets a ON a.id = pr.machine_id`
      : sql``;
    const lineJoin = dim.joinLines
      ? sql`LEFT JOIN assets ln ON ln.id = COALESCE(pr.line_id, a.parent_id)`
      : sql``;
    const plantJoin = dim.joinPlants
      ? sql`LEFT JOIN plants p ON p.id = pr.plant_id`
      : sql``;
    const lineFilter = filters.lineId
      ? sql`AND pr.line_id = ${filters.lineId}`
      : sql``;
    const machineFilter = filters.machineId
      ? sql`AND pr.machine_id = ${filters.machineId}`
      : sql``;
    const shiftFilter = filters.shift
      ? sql`AND pr.shift = ${filters.shift}`
      : sql``;

    let valueExpr: SQL;
    if (metric.id === "availability") {
      valueExpr = sql`ROUND((COALESCE(SUM(pr.run_time_min) / NULLIF(SUM(pr.planned_time_min), 0), 0) * 100)::numeric, 2)::double precision`;
    } else if (metric.id === "performance") {
      valueExpr = sql`ROUND((LEAST(COALESCE(SUM((pr.good_count + pr.scrap_count) * pr.ideal_cycle_time_sec / 60.0) / NULLIF(SUM(pr.run_time_min), 0), 0), 1.0) * 100)::numeric, 2)::double precision`;
    } else if (metric.id === "quality") {
      valueExpr = sql`ROUND((COALESCE(SUM(pr.good_count)::double precision / NULLIF(SUM(pr.good_count + pr.scrap_count), 0), 0) * 100)::numeric, 2)::double precision`;
    } else if (metric.id === "scrap_rate") {
      valueExpr = sql`ROUND((COALESCE(SUM(pr.scrap_count)::double precision / NULLIF(SUM(pr.good_count + pr.scrap_count), 0), 0) * 100)::numeric, 2)::double precision`;
    } else if (metric.id === "throughput") {
      valueExpr = sql`COALESCE(SUM(pr.good_count), 0)::double precision`;
    } else {
      // oee
      valueExpr = sql`ROUND((
        COALESCE(SUM(pr.run_time_min) / NULLIF(SUM(pr.planned_time_min), 0), 0)
        * LEAST(COALESCE(SUM((pr.good_count + pr.scrap_count) * pr.ideal_cycle_time_sec / 60.0) / NULLIF(SUM(pr.run_time_min), 0), 0), 1.0)
        * COALESCE(SUM(pr.good_count)::double precision / NULLIF(SUM(pr.good_count + pr.scrap_count), 0), 0)
        * 100
      )::numeric, 2)::double precision`;
    }

    const orderBy =
      input.groupBy === "day" || input.groupBy === "week"
        ? sql`ORDER BY dim_id ASC`
        : sql`ORDER BY val ${sortDir}`;

    const groupClause = input.groupBy ? sql`GROUP BY ${dim.groupExpr}` : sql``;

    const queryResult = await db.execute(sql`
      SELECT
        ${dim.selectLabel} AS dim_label,
        ${dim.selectId} AS dim_id,
        ${valueExpr} AS val
      FROM production_runs pr
      ${assetJoin}
      ${lineJoin}
      ${plantJoin}
      WHERE pr.tenant_id = ${user.tenantId}
        AND pr.plant_id IN (${buildInList(scopedPlants)})
        AND pr.started_at >= ${sinceIso}::timestamptz
        AND pr.started_at < ${untilIso}::timestamptz
        ${lineFilter}
        ${machineFilter}
        ${shiftFilter}
      ${groupClause}
      ${orderBy}
      LIMIT ${limit + 1}
    `);

    const summaryRes = await db.execute(sql`
      SELECT ${valueExpr} AS val
      FROM production_runs pr
      WHERE pr.tenant_id = ${user.tenantId}
        AND pr.plant_id IN (${buildInList(scopedPlants)})
        AND pr.started_at >= ${sinceIso}::timestamptz
        AND pr.started_at < ${untilIso}::timestamptz
        ${lineFilter}
        ${machineFilter}
        ${shiftFilter}
    `);

    const summaryVal = Number(
      (summaryRes.rows?.[0] as { val?: number } | undefined)?.val ?? 0
    );
    const rawRows = (queryResult.rows ?? []) as Array<{
      dim_label: string;
      dim_id: string;
      val: number;
    }>;

    return {
      rows: rawRows.slice(0, limit).map((r) => ({
        dimension: String(r.dim_label),
        dimensionId: String(r.dim_id),
        value: Number(r.val ?? 0),
        unit: metric.unit
      })),
      summaryValue: Number(summaryVal.toFixed(2)),
      sqlPreview: `SELECT ${metric.id} FROM production_runs WHERE tenant_id = $1 AND plant_id IN (...) GROUP BY ${input.groupBy ?? "all"}`
    };
  }

  // Downtime minutes
  if (metric.id === "downtime_minutes") {
    const dim = buildDimensionExpr(input.groupBy, sql`de.start`, "de");
    const needAssetJoin = dim.joinAssets || Boolean(filters.lineId);
    const assetJoin = needAssetJoin
      ? sql`LEFT JOIN assets a ON a.id = de.machine_id`
      : sql``;
    const lineJoin = dim.joinLines
      ? sql`LEFT JOIN assets ln ON ln.id = a.parent_id`
      : sql``;
    const plantJoin = dim.joinPlants
      ? sql`LEFT JOIN plants p ON p.id = de.plant_id`
      : sql``;
    const lineFilter = filters.lineId
      ? sql`AND a.parent_id = ${filters.lineId}`
      : sql``;
    const machineFilter = filters.machineId
      ? sql`AND de.machine_id = ${filters.machineId}`
      : sql``;
    const orderBy =
      input.groupBy === "day" || input.groupBy === "week"
        ? sql`ORDER BY dim_id ASC`
        : sql`ORDER BY val ${sortDir}`;
    const groupClause = input.groupBy ? sql`GROUP BY ${dim.groupExpr}` : sql``;

    const queryResult = await db.execute(sql`
      SELECT
        ${dim.selectLabel} AS dim_label,
        ${dim.selectId} AS dim_id,
        ROUND(COALESCE(SUM(de.duration_min), 0)::numeric, 1)::double precision AS val
      FROM downtime_events de
      ${assetJoin}
      ${lineJoin}
      ${plantJoin}
      WHERE de.tenant_id = ${user.tenantId}
        AND de.plant_id IN (${buildInList(scopedPlants)})
        AND de.start >= ${sinceIso}::timestamptz
        AND de.start < ${untilIso}::timestamptz
        ${lineFilter}
        ${machineFilter}
      ${groupClause}
      ${orderBy}
      LIMIT ${limit + 1}
    `);

    const summaryRes = await db.execute(sql`
      SELECT ROUND(COALESCE(SUM(de.duration_min), 0)::numeric, 1)::double precision AS val
      FROM downtime_events de
      LEFT JOIN assets a ON a.id = de.machine_id
      WHERE de.tenant_id = ${user.tenantId}
        AND de.plant_id IN (${buildInList(scopedPlants)})
        AND de.start >= ${sinceIso}::timestamptz
        AND de.start < ${untilIso}::timestamptz
        ${lineFilter}
        ${machineFilter}
    `);

    const rawRows = (queryResult.rows ?? []) as Array<{
      dim_label: string;
      dim_id: string;
      val: number;
    }>;

    return {
      rows: rawRows.slice(0, limit).map((r) => ({
        dimension: String(r.dim_label),
        dimensionId: String(r.dim_id),
        value: Number(r.val ?? 0),
        unit: metric.unit
      })),
      summaryValue: Number(
        (summaryRes.rows?.[0] as { val?: number } | undefined)?.val ?? 0
      ),
      sqlPreview: `SELECT SUM(duration_min) FROM downtime_events WHERE tenant_id = $1 AND plant_id IN (...)`
    };
  }

  // Energy kWh
  if (metric.id === "energy_kwh") {
    const dim = buildDimensionExpr(input.groupBy, sql`er.ts`, "er");
    const needAssetJoin = dim.joinAssets || Boolean(filters.lineId);
    const assetJoin = needAssetJoin
      ? sql`LEFT JOIN assets a ON a.id = er.machine_id`
      : sql``;
    const lineJoin = dim.joinLines
      ? sql`LEFT JOIN assets ln ON ln.id = a.parent_id`
      : sql``;
    const plantJoin = dim.joinPlants
      ? sql`LEFT JOIN plants p ON p.id = er.plant_id`
      : sql``;
    const lineFilter = filters.lineId
      ? sql`AND a.parent_id = ${filters.lineId}`
      : sql``;
    const machineFilter = filters.machineId
      ? sql`AND er.machine_id = ${filters.machineId}`
      : sql``;
    const orderBy =
      input.groupBy === "day" || input.groupBy === "week"
        ? sql`ORDER BY dim_id ASC`
        : sql`ORDER BY val ${sortDir}`;
    const groupClause = input.groupBy ? sql`GROUP BY ${dim.groupExpr}` : sql``;

    const queryResult = await db.execute(sql`
      SELECT
        ${dim.selectLabel} AS dim_label,
        ${dim.selectId} AS dim_id,
        ROUND(COALESCE(SUM(er.kwh), 0)::numeric, 1)::double precision AS val
      FROM energy_readings er
      ${assetJoin}
      ${lineJoin}
      ${plantJoin}
      WHERE er.tenant_id = ${user.tenantId}
        AND er.plant_id IN (${buildInList(scopedPlants)})
        AND er.ts >= ${sinceIso}::timestamptz
        AND er.ts < ${untilIso}::timestamptz
        ${lineFilter}
        ${machineFilter}
      ${groupClause}
      ${orderBy}
      LIMIT ${limit + 1}
    `);

    const summaryRes = await db.execute(sql`
      SELECT ROUND(COALESCE(SUM(er.kwh), 0)::numeric, 1)::double precision AS val
      FROM energy_readings er
      LEFT JOIN assets a ON a.id = er.machine_id
      WHERE er.tenant_id = ${user.tenantId}
        AND er.plant_id IN (${buildInList(scopedPlants)})
        AND er.ts >= ${sinceIso}::timestamptz
        AND er.ts < ${untilIso}::timestamptz
        ${lineFilter}
        ${machineFilter}
    `);

    const rawRows = (queryResult.rows ?? []) as Array<{
      dim_label: string;
      dim_id: string;
      val: number;
    }>;

    return {
      rows: rawRows.slice(0, limit).map((r) => ({
        dimension: String(r.dim_label),
        dimensionId: String(r.dim_id),
        value: Number(r.val ?? 0),
        unit: metric.unit
      })),
      summaryValue: Number(
        (summaryRes.rows?.[0] as { val?: number } | undefined)?.val ?? 0
      ),
      sqlPreview: `SELECT SUM(kwh) FROM energy_readings WHERE tenant_id = $1 AND plant_id IN (...)`
    };
  }

  // Work order reliability metrics: mtbf, mttr, open_work_orders
  if (["mtbf", "mttr", "open_work_orders"].includes(metric.id)) {
    const dim = buildDimensionExpr(input.groupBy, sql`wo.opened_at`, "wo");
    const needAssetJoin = dim.joinAssets || Boolean(filters.lineId);
    const assetJoin = needAssetJoin
      ? sql`LEFT JOIN assets a ON a.id = wo.machine_id`
      : sql``;
    const lineJoin = dim.joinLines
      ? sql`LEFT JOIN assets ln ON ln.id = a.parent_id`
      : sql``;
    const plantJoin = dim.joinPlants
      ? sql`LEFT JOIN plants p ON p.id = wo.plant_id`
      : sql``;
    const lineFilter = filters.lineId
      ? sql`AND a.parent_id = ${filters.lineId}`
      : sql``;
    const machineFilter = filters.machineId
      ? sql`AND wo.machine_id = ${filters.machineId}`
      : sql``;

    let extraFilter = sql``;
    let valExpr: SQL;

    if (metric.id === "open_work_orders") {
      extraFilter = sql`AND wo.status IN ('open', 'in_progress')`;
      valExpr = sql`COUNT(*)::double precision`;
    } else if (metric.id === "mttr") {
      extraFilter = sql`AND wo.type = 'corrective' AND wo.closed_at IS NOT NULL AND wo.opened_at >= ${sinceIso}::timestamptz AND wo.opened_at < ${untilIso}::timestamptz`;
      valExpr = sql`ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (wo.closed_at - wo.opened_at)) / 3600.0), 0)::numeric, 2)::double precision`;
    } else {
      extraFilter = sql`AND wo.type = 'corrective' AND wo.opened_at >= ${sinceIso}::timestamptz AND wo.opened_at < ${untilIso}::timestamptz`;
      valExpr = sql`ROUND((${rangeHours}::double precision / GREATEST(COUNT(*), 1))::numeric, 1)::double precision`;
    }

    const orderBy =
      input.groupBy === "day" || input.groupBy === "week"
        ? sql`ORDER BY dim_id ASC`
        : sql`ORDER BY val ${sortDir}`;
    const groupClause = input.groupBy ? sql`GROUP BY ${dim.groupExpr}` : sql``;

    const queryResult = await db.execute(sql`
      SELECT
        ${dim.selectLabel} AS dim_label,
        ${dim.selectId} AS dim_id,
        ${valExpr} AS val
      FROM work_orders wo
      ${assetJoin}
      ${lineJoin}
      ${plantJoin}
      WHERE wo.tenant_id = ${user.tenantId}
        AND wo.plant_id IN (${buildInList(scopedPlants)})
        ${extraFilter}
        ${lineFilter}
        ${machineFilter}
      ${groupClause}
      ${orderBy}
      LIMIT ${limit + 1}
    `);

    const summaryRes = await db.execute(sql`
      SELECT ${valExpr} AS val
      FROM work_orders wo
      LEFT JOIN assets a ON a.id = wo.machine_id
      WHERE wo.tenant_id = ${user.tenantId}
        AND wo.plant_id IN (${buildInList(scopedPlants)})
        ${extraFilter}
        ${lineFilter}
        ${machineFilter}
    `);

    const rawRows = (queryResult.rows ?? []) as Array<{
      dim_label: string;
      dim_id: string;
      val: number;
    }>;

    return {
      rows: rawRows.slice(0, limit).map((r) => ({
        dimension: String(r.dim_label),
        dimensionId: String(r.dim_id),
        value: Number(r.val ?? 0),
        unit: metric.unit
      })),
      summaryValue: Number(
        (summaryRes.rows?.[0] as { val?: number } | undefined)?.val ?? 0
      ),
      sqlPreview: `SELECT ${metric.id} FROM work_orders WHERE tenant_id = $1 AND plant_id IN (...)`
    };
  }

  // Inventory metric: parts_below_min_stock
  const dim = buildDimensionExpr(input.groupBy, sql`NOW()`, "inv");
  const plantJoin = dim.joinPlants
    ? sql`LEFT JOIN plants p ON p.id = inv.plant_id`
    : sql``;
  const groupClause = input.groupBy ? sql`GROUP BY ${dim.groupExpr}` : sql``;

  const queryResult = await db.execute(sql`
    SELECT
      ${dim.selectLabel} AS dim_label,
      ${dim.selectId} AS dim_id,
      COUNT(*)::double precision AS val
    FROM inventory inv
    ${plantJoin}
    WHERE inv.tenant_id = ${user.tenantId}
      AND inv.plant_id IN (${buildInList(scopedPlants)})
      AND (inv.on_hand - inv.reserved) < inv.min_level
    ${groupClause}
    ORDER BY val ${sortDir}
    LIMIT ${limit + 1}
  `);

  const summaryRes = await db.execute(sql`
    SELECT COUNT(*)::double precision AS val
    FROM inventory inv
    WHERE inv.tenant_id = ${user.tenantId}
      AND inv.plant_id IN (${buildInList(scopedPlants)})
      AND (inv.on_hand - inv.reserved) < inv.min_level
  `);

  const rawRows = (queryResult.rows ?? []) as Array<{
    dim_label: string;
    dim_id: string;
    val: number;
  }>;

  return {
    rows: rawRows.slice(0, limit).map((r) => ({
      dimension: String(r.dim_label),
      dimensionId: String(r.dim_id),
      value: Number(r.val ?? 0),
      unit: metric.unit
    })),
    summaryValue: Number(
      (summaryRes.rows?.[0] as { val?: number } | undefined)?.val ?? 0
    ),
    sqlPreview: `SELECT COUNT(*) FROM inventory WHERE tenant_id = $1 AND plant_id IN (...) AND (on_hand - reserved) < min_level`
  };
}

/**
 * Executes a governed semantic metric query with server-side RBAC + plant scoping.
 */
export async function querySemanticMetric(
  db: LuticDatabase,
  user: SessionUser,
  rawInput: unknown
): Promise<MetricQueryResult> {
  const input = MetricQueryInputSchema.parse(rawInput);
  const metric = METRIC_REGISTRY[input.metric];
  if (!metric) {
    throw new Error(`Unknown semantic metric '${input.metric}'`);
  }

  if (input.groupBy && !metric.allowedDimensions.includes(input.groupBy)) {
    throw new Error(
      `Dimension '${input.groupBy}' is not supported for metric '${metric.id}'. Allowed: ${metric.allowedDimensions.join(", ")}`
    );
  }

  // Enforce permission & plant scope from session (never trust caller plant args blindly)
  authorize(user, "metrics:read", {
    tenantId: user.tenantId,
    plantId: input.filters?.plantId
  });

  const scopedPlants = input.filters?.plantId
    ? [input.filters.plantId]
    : user.plantIds;

  if (scopedPlants.length === 0) {
    return {
      metric,
      range: input.range,
      groupBy: input.groupBy,
      summaryValue: 0,
      rows: [],
      truncated: false,
      cached: false,
      sqlPreview: ""
    };
  }

  const cacheKey = JSON.stringify({
    tenantId: user.tenantId,
    plants: [...scopedPlants].sort(),
    input
  });
  const hit = queryCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return { ...hit.result, cached: true };
  }

  const now = new Date();
  const hours = getRangeHours(input.range);
  const since = new Date(now.getTime() - hours * 3600 * 1000);
  const current = await runMetricWindow(
    db,
    user,
    metric,
    input,
    since.toISOString(),
    now.toISOString(),
    scopedPlants
  );

  let previousSummaryValue: number | undefined;
  let mergedRows = current.rows;
  if (input.compareTo === "previous_period") {
    const prevSince = new Date(since.getTime() - hours * 3600 * 1000);
    const prev = await runMetricWindow(
      db,
      user,
      metric,
      input,
      prevSince.toISOString(),
      since.toISOString(),
      scopedPlants
    );
    previousSummaryValue = prev.summaryValue;
    const prevMap = new Map(prev.rows.map((r) => [r.dimension, r.value]));
    mergedRows = current.rows.map((r) => ({
      ...r,
      previousValue: prevMap.get(r.dimension)
    }));
  }

  const result: MetricQueryResult = {
    metric,
    range: input.range,
    groupBy: input.groupBy,
    summaryValue: current.summaryValue,
    previousSummaryValue,
    rows: mergedRows,
    truncated: current.rows.length >= Math.min(input.limit ?? 25, 50),
    cached: false,
    sqlPreview: current.sqlPreview
  };

  queryCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    result
  });

  return result;
}
