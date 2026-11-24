import type { LuticDatabase } from "./client";
import * as schema from "./schema";

interface ToolkitDefinition {
  id: string;
  name: string;
  description: string;
  tools: string[];
  roles: Array<"engineer" | "analyst" | "manager" | "admin">;
}

const paasToolkit: ToolkitDefinition = {
  id: "tk-paas",
  name: "paas",
  description: "Workflows, monitoring alerts, notification topics, queues, and isolated Lutic Code Mode",
  tools: [
    "paas.list_workflows", "paas.trigger_workflow", "paas.list_alerts",
    "paas.acknowledge_alert", "paas.publish_notification", "paas.inspect_queues",
    "execute_connector_code"
  ],
  roles: ["engineer", "analyst", "manager", "admin"]
};

export async function installCoreToolkits(db: LuticDatabase, tenantId: string, idPrefix: string): Promise<void> {
  await installToolkits(db, tenantId, idPrefix, [
    {
      id: "tk-knowledge",
      name: "knowledge",
      description: "Manuals, SOPs, safety policies, and knowledge base search",
      tools: ["search_documents", "get_document_section"],
      roles: ["engineer", "analyst", "manager", "admin"]
    },
    {
      id: "tk-machine",
      name: "machine",
      description: "Machine hierarchy, live status, active alarms, and aggregated sensor readings",
      tools: ["list_machines", "get_machine", "get_machine_status", "get_active_alarms", "get_alarm_history", "get_recent_readings"],
      roles: ["engineer", "analyst", "manager", "admin"]
    },
    {
      id: "tk-maintenance",
      name: "maintenance",
      description: "Work orders, machine repair history, similar faults, and spare parts inventory",
      tools: ["get_work_orders", "get_machine_history", "find_similar_faults", "get_parts_inventory", "find_part_for_fault"],
      roles: ["engineer", "analyst", "manager", "admin"]
    },
    {
      id: "tk-analytics",
      name: "analytics",
      description: "Semantic layer production, quality, OEE, downtime, energy metrics and dashboards",
      tools: ["list_metrics", "query_metric", "compare_metrics", "create_dashboard_draft", "list_dashboards"],
      roles: ["analyst", "manager", "admin"]
    },
    {
      id: "tk-action",
      name: "action",
      description: "Confirmed write actions: draft work orders and reserve spare parts",
      tools: ["draft_work_order", "reserve_part"],
      roles: ["engineer", "admin"]
    },
    paasToolkit
  ]);
}

export async function installPaasToolkit(db: LuticDatabase, tenantId: string): Promise<void> {
  await installToolkits(db, tenantId, "", [paasToolkit]);
}

async function installToolkits(db: LuticDatabase, tenantId: string, idPrefix: string, toolkitDefs: ToolkitDefinition[]): Promise<void> {
  await db.insert(schema.toolkits).values(
    toolkitDefs.map((tk) => ({
      id: `${idPrefix}${tk.id}`,
      tenantId,
      name: tk.name,
      description: tk.description
    }))
  );

  await db.insert(schema.toolkitTools).values(
    toolkitDefs.flatMap((tk) =>
      tk.tools.map((toolName) => ({
        id: `${idPrefix}tt-${tk.name}-${toolName}`,
        tenantId,
        toolkitId: `${idPrefix}${tk.id}`,
        toolName,
        enabled: true
      }))
    )
  );

  await db.insert(schema.roleToolkits).values(
    toolkitDefs.flatMap((tk) =>
      tk.roles.map((role) => ({
        id: `${idPrefix}rt-${role}-${tk.name}`,
        tenantId,
        role,
        toolkitId: `${idPrefix}${tk.id}`,
        enabled: true
      }))
    )
  );
}
