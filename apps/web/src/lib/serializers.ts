import type {
  alertRules,
  connectorConnections,
  workflows
} from "@kojo/core";

export function serializeWorkflow(row: typeof workflows.$inferSelect) {
  const def = (row.definition ?? { nodes: [], edges: [] }) as {
    nodes?: unknown[];
    edges?: unknown[];
  };
  return {
    ...row,
    nodes: Array.isArray(def.nodes) ? def.nodes : [],
    edges: Array.isArray(def.edges) ? def.edges : []
  };
}

export function sanitizeConnector(
  row: typeof connectorConnections.$inferSelect
) {
  const cfg = (row.config ?? {}) as Record<string, unknown>;
  const kind = typeof cfg.kind === "string" ? cfg.kind : row.slug;
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    kind,
    name: row.name,
    category: row.category,
    transport: row.transport,
    endpointUrl: row.endpointUrl,
    status: row.status,
    hasCredentials: Boolean(row.encryptedCredentials),
    config: cfg,
    discoveredTools: row.discoveredTools ?? [],
    lastSyncAt: row.lastSyncAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function serializeRule(r: typeof alertRules.$inferSelect) {
  return {
    ...r,
    metric: r.metricTag
  };
}
