import crypto from "node:crypto";
import { z } from "zod";
import {
  and,
  dashboards,
  DashboardSpecSchema,
  desc,
  eq,
  isDashboardSharedWithUser,
  listMetrics,
  MetricQueryInputSchema,
  productionRuns,
  querySemanticMetric,
  SemanticDimensionSchema,
  sql,
  TimeRangeSchema,
  type DashboardSpec,
  type LuticDatabase
} from "@lutic/core";
import {
  buildConnectorMcpServer,
  type Connector,
  type ConnectorHealth,
  type ConnectorToolDefinition
} from "../types";

const MesCredentialSchema = z.object({
  endpoint: z.string().min(1).default("mock://mes.local"),
  apiKey: z.string().min(1).default("mes-demo-key"),
  shiftCalendar: z.string().default("3-shift-24h")
});

const EmptySchema = z.object({});

const CompareMetricsSchema = z.object({
  primaryMetric: z.string().min(1),
  secondaryMetric: z.string().min(1),
  groupBy: SemanticDimensionSchema.default("line"),
  range: TimeRangeSchema.default("7d"),
  plantId: z.string().optional(),
  lineId: z.string().optional()
});

const CreateDashboardDraftSchema = z.object({
  title: z.string().min(1).max(140),
  description: z.string().max(400).optional().default(""),
  range: TimeRangeSchema.default("7d"),
  plantId: z.string().optional(),
  lineId: z.string().optional(),
  widgets: z
    .array(
      z.object({
        type: z.enum([
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
        ]),
        title: z.string().min(1),
        metric: z.string().optional(),
        groupBy: SemanticDimensionSchema.optional(),
        range: TimeRangeSchema.optional(),
        target: z.number().optional(),
        content: z.string().optional()
      })
    )
    .min(1)
    .max(12)
});

const mesTools: ConnectorToolDefinition[] = [
  {
    name: "list_metrics",
    description:
      "List governed semantic-layer metrics (OEE, availability, performance, quality, downtime_minutes, scrap_rate, throughput, mtbf, mttr, energy_kwh, open_work_orders, parts_below_min_stock) and allowed dimensions.",
    inputSchema: EmptySchema,
    requiredPermission: "metrics:read",
    access: "read",
    toolkit: "analytics",
    riskLevel: "low",
    connectorKind: "mes",
    execute: async () => {
      return { metrics: listMetrics() };
    }
  },
  {
    name: "query_metric",
    description:
      "Query a governed semantic-layer production, quality, downtime, reliability, or energy metric with session-enforced plant scoping.",
    inputSchema: MetricQueryInputSchema,
    requiredPermission: "metrics:read",
    access: "read",
    toolkit: "analytics",
    riskLevel: "low",
    connectorKind: "mes",
    execute: async (rawArgs, ctx) => {
      const parsed = MetricQueryInputSchema.parse(rawArgs);
      const result = await querySemanticMetric(ctx.db, ctx.user, parsed);
      return { ...result };
    }
  },
  {
    name: "compare_metrics",
    description: "Compare two semantic-layer metrics side by side across a shared dimension.",
    inputSchema: CompareMetricsSchema,
    requiredPermission: "metrics:read",
    access: "read",
    toolkit: "analytics",
    riskLevel: "low",
    connectorKind: "mes",
    execute: async (rawArgs, ctx) => {
      const args = CompareMetricsSchema.parse(rawArgs);
      const filters = {
        plantId: args.plantId,
        lineId: args.lineId
      };
      const [primary, secondary] = await Promise.all([
        querySemanticMetric(ctx.db, ctx.user, {
          metric: args.primaryMetric,
          groupBy: args.groupBy,
          range: args.range,
          filters
        }),
        querySemanticMetric(ctx.db, ctx.user, {
          metric: args.secondaryMetric,
          groupBy: args.groupBy,
          range: args.range,
          filters
        })
      ]);

      const secMap = new Map(secondary.rows.map((r) => [r.dimension, r.value]));
      const merged = primary.rows.map((r) => ({
        dimension: r.dimension,
        [primary.metric.id]: r.value,
        [secondary.metric.id]: secMap.get(r.dimension) ?? 0
      }));

      return {
        primaryMetric: primary.metric,
        secondaryMetric: secondary.metric,
        groupBy: args.groupBy,
        range: args.range,
        comparisonRows: merged
      };
    }
  },
  {
    name: "create_dashboard_draft",
    description:
      "Generate a declarative, zod-validated dashboard specification referencing semantic-layer metrics (never raw SQL).",
    inputSchema: CreateDashboardDraftSchema,
    requiredPermission: "dashboard:write",
    access: "read",
    toolkit: "analytics",
    riskLevel: "medium",
    connectorKind: "mes",
    execute: async (rawArgs, ctx) => {
      const args = CreateDashboardDraftSchema.parse(rawArgs);
      const plantScope = args.plantId
        ? [args.plantId]
        : [...ctx.user.plantIds];

      let curX = 0;
      let curY = 0;
      const widgets = args.widgets.map((w, idx) => {
        const id = `w-${idx + 1}`;
        return {
          id,
          type: w.type,
          title: w.title,
          metric: w.metric,
          groupBy: w.groupBy,
          filters: {
            ...(args.plantId ? { plantId: args.plantId } : {}),
            ...(args.lineId ? { lineId: args.lineId } : {})
          },
          range: w.range ?? args.range,
          sort: "desc" as const,
          limit: 12,
          target: w.target,
          content: w.content
        };
      });

      const layout = widgets.map((w) => {
        const isKpi = w.type === "kpi" || w.type === "gauge";
        const width = isKpi ? 4 : 6;
        const height = isKpi ? 3 : 5;
        if (curX + width > 12) {
          curX = 0;
          curY += 5;
        }
        const item = { i: w.id, x: curX, y: curY, w: width, h: height };
        curX += width;
        if (curX >= 12) {
          curX = 0;
          curY += height;
        }
        return item;
      });

      const draft: DashboardSpec = DashboardSpecSchema.parse({
        id: `draft-${crypto.randomUUID().slice(0, 8)}`,
        title: args.title,
        description: args.description,
        plantScope,
        filters: {
          range: args.range,
          plantId: args.plantId,
          lineId: args.lineId
        },
        widgets,
        layout,
        version: 1
      });

      return { draftSpec: draft };
    }
  },
  {
    name: "list_dashboards",
    description: "List saved and shared dashboards visible to the current user.",
    inputSchema: EmptySchema,
    requiredPermission: "dashboard:read",
    access: "read",
    toolkit: "analytics",
    riskLevel: "low",
    connectorKind: "mes",
    execute: async (_rawArgs, ctx) => {
      const rows = await ctx.db
        .select()
        .from(dashboards)
        .where(eq(dashboards.tenantId, ctx.user.tenantId))
        .orderBy(desc(dashboards.updatedAt))
        .limit(50);

      const shareRows = await ctx.db.execute(
        sql`SELECT dashboard_id, share_type, target_id FROM dashboard_shares WHERE tenant_id = ${ctx.user.tenantId}`
      );

      const shareMap = new Map<
        string,
        Array<{ shareType: "role" | "plant"; targetId: string }>
      >();
      for (const s of (shareRows.rows ?? []) as Array<{
        dashboard_id: string;
        share_type: "role" | "plant";
        target_id: string;
      }>) {
        const list = shareMap.get(s.dashboard_id) ?? [];
        list.push({ shareType: s.share_type, targetId: s.target_id });
        shareMap.set(s.dashboard_id, list);
      }

      const visible = rows.filter((d) =>
        isDashboardSharedWithUser(ctx.user, {
          tenantId: d.tenantId,
          ownerId: d.ownerId,
          plantScope: d.plantScope,
          shares: shareMap.get(d.id) ?? []
        })
      );

      return {
        dashboards: visible.map((d) => ({
          id: d.id,
          title: d.title,
          description: d.description,
          plantScope: d.plantScope,
          currentVersion: d.currentVersion,
          isTemplate: d.isTemplate,
          updatedAt: d.updatedAt
        }))
      };
    }
  }
];

export const mesConnector: Connector = {
  id: "connector-mes",
  kind: "mes",
  name: "Mock MES & Semantic Analytics",
  credentialSchema: MesCredentialSchema,
  async healthCheck(db: LuticDatabase, tenantId: string): Promise<ConnectorHealth> {
    const start = Date.now();
    await db
      .select({ id: productionRuns.id })
      .from(productionRuns)
      .where(and(eq(productionRuns.tenantId, tenantId)))
      .limit(1);
    return {
      id: "connector-mes",
      kind: "mes",
      status: "healthy",
      latencyMs: Date.now() - start,
      message: "MES OEE, quality, downtime & energy metrics ready"
    };
  },
  listTools: () => mesTools,
  createMcpServer: () => buildConnectorMcpServer("mes", mesTools)
};
