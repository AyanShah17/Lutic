export type SandboxServiceId =
  | "board"
  | "machines"
  | "monitoring"
  | "dashboards"
  | "workflows"
  | "connectors"
  | "notifications"
  | "queues";

export type AgentScopeId = SandboxServiceId | "overview";

export type ChangeTargetType =
  | "machine_connection"
  | "machine_criticality"
  | "dashboard"
  | "workflow"
  | "alert_rule"
  | "board_issue";

export interface ServiceSkillDefinition {
  id: string;
  serviceId: SandboxServiceId;
  name: string;
  description: string;
  tools: string[];
  changeTypes?: ChangeTargetType[];
}

export interface SandboxServiceDefinition {
  id: SandboxServiceId;
  name: string;
  shortName: string;
  href: string;
  group: "operations" | "automation" | "messaging";
  tag: string;
  description: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  skills: ServiceSkillDefinition[];
  allowedTools: string[];
  allowedChangeTypes: ChangeTargetType[];
  defaultEnabledForNewSandbox: boolean;
}

export interface TenantSandboxServiceView extends SandboxServiceDefinition {
  enabled: boolean;
  pinnedToDashboard: boolean;
  enabledSkills: string[];
  agentInstructions: string;
  displayOrder: number;
}

export interface AgentCapabilities {
  scopeId: AgentScopeId;
  agentId: string;
  agentName: string;
  isOverview: boolean;
  enabled: boolean;
  activeServiceIds: SandboxServiceId[];
  disabledServiceIds: SandboxServiceId[];
  activeSkills: ServiceSkillDefinition[];
  allowedToolNames: Set<string>;
  allowedChangeTypes: Set<ChangeTargetType>;
}

export const STARTER_SANDBOX_SERVICE_IDS: ReadonlyArray<SandboxServiceId> = [
  "board",
  "dashboards",
  "workflows",
  "connectors"
];

export const SANDBOX_SERVICE_CATALOG: ReadonlyArray<SandboxServiceDefinition> = [
  {
    id: "board",
    name: "AI Board",
    shortName: "Board",
    href: "/board",
    group: "operations",
    tag: "Kanban + Triage",
    description: "Track incidents, escalations, work orders, spare parts, and sprint tasks.",
    agentId: "agent-board",
    agentName: "AI Board Agent",
    agentRole: "Issue triage, work orders, and spare parts reservations within AI Board.",
    defaultEnabledForNewSandbox: true,
    skills: [
      {
        id: "board.triage_issues",
        serviceId: "board",
        name: "Issue & Fault Triage",
        description: "Review work orders, repair history, similar faults, and update board issues.",
        tools: ["get_work_orders", "get_machine_history", "find_similar_faults"],
        changeTypes: ["board_issue"]
      },
      {
        id: "board.work_order_draft",
        serviceId: "board",
        name: "Work Order Drafting",
        description: "Propose confirmed maintenance work orders.",
        tools: ["draft_work_order"]
      },
      {
        id: "board.parts_reservation",
        serviceId: "board",
        name: "Spare Parts Lookup & Reserve",
        description: "Check warehouse stock and reserve spare parts with approval.",
        tools: ["get_parts_inventory", "find_part_for_fault", "reserve_part"]
      }
    ],
    allowedTools: [
      "get_work_orders",
      "get_machine_history",
      "find_similar_faults",
      "draft_work_order",
      "get_parts_inventory",
      "find_part_for_fault",
      "reserve_part"
    ],
    allowedChangeTypes: ["board_issue"]
  },
  {
    id: "dashboards",
    name: "Semantic Dashboards",
    shortName: "Dashboards",
    href: "/dashboards",
    group: "automation",
    tag: "KPI + Analytics",
    description: "Build semantic KPI boards, compare periods, and edit dashboard widgets.",
    agentId: "agent-dashboards",
    agentName: "AI Dashboard Agent",
    agentRole: "Semantic metric queries, period comparisons, and dashboard widget authoring.",
    defaultEnabledForNewSandbox: true,
    skills: [
      {
        id: "dashboards.semantic_kpi",
        serviceId: "dashboards",
        name: "Semantic Metric Queries",
        description: "List and query governed OEE, availability, scrap, downtime, and energy metrics.",
        tools: ["list_metrics", "query_metric"]
      },
      {
        id: "dashboards.compare_periods",
        serviceId: "dashboards",
        name: "Metric Comparison",
        description: "Compare KPIs across plants, lines, and time windows.",
        tools: ["compare_metrics"]
      },
      {
        id: "dashboards.spec_builder",
        serviceId: "dashboards",
        name: "Dashboard Layout Authoring",
        description: "Draft and refine semantic dashboard specifications and widgets.",
        tools: ["create_dashboard_draft", "list_dashboards"],
        changeTypes: ["dashboard"]
      }
    ],
    allowedTools: [
      "list_metrics",
      "query_metric",
      "compare_metrics",
      "create_dashboard_draft",
      "list_dashboards"
    ],
    allowedChangeTypes: ["dashboard"]
  },
  {
    id: "workflows",
    name: "AI Canvas & Workflows",
    shortName: "Workflows",
    href: "/workflows",
    group: "automation",
    tag: "DAG Canvas",
    description: "Visual node/edge automation canvas with draft generation and step traces.",
    agentId: "agent-workflows",
    agentName: "AI Canvas Agent",
    agentRole: "Create, toggle, inspect, and trigger DAG workflows inside AI Canvas.",
    defaultEnabledForNewSandbox: true,
    skills: [
      {
        id: "workflows.dag_authoring",
        serviceId: "workflows",
        name: "DAG Workflow Authoring",
        description: "Inspect workflow graphs and propose/save new or updated DAG definitions.",
        tools: ["paas.list_workflows"],
        changeTypes: ["workflow"]
      },
      {
        id: "workflows.execution_dispatch",
        serviceId: "workflows",
        name: "Workflow Execution Dispatch",
        description: "Trigger enabled workflows with human confirmation.",
        tools: ["paas.trigger_workflow"]
      }
    ],
    allowedTools: ["paas.list_workflows", "paas.trigger_workflow"],
    allowedChangeTypes: ["workflow"]
  },
  {
    id: "connectors",
    name: "Connectors Hub",
    shortName: "Connectors",
    href: "/connectors",
    group: "automation",
    tag: "OAuth + MCP",
    description: "Connect external apps with OAuth 2.0 + PKCE, API keys, remote MCP, and OpenAPI.",
    agentId: "agent-connectors",
    agentName: "Connectors Agent",
    agentRole: "Connector vault diagnostics and sandboxed multi-connector scripting.",
    defaultEnabledForNewSandbox: true,
    skills: [
      {
        id: "connectors.vault_diagnostics",
        serviceId: "connectors",
        name: "Connection & Auth Blueprints",
        description: "Inspect active integration auth schemes and sync health.",
        tools: []
      },
      {
        id: "connectors.code_mode",
        serviceId: "connectors",
        name: "Isolated Code Execution",
        description: "Run isolated connector scripts in trusted development and test environments.",
        tools: ["execute_connector_code"]
      }
    ],
    allowedTools: ["execute_connector_code"],
    allowedChangeTypes: []
  },
  {
    id: "machines",
    name: "Machine Fleet & Topology",
    shortName: "Machines",
    href: "/machines",
    group: "operations",
    tag: "Topology + SOP",
    description: "Equipment asset hierarchy, live machine sensors, topology graph, and SOP search.",
    agentId: "agent-machines",
    agentName: "Machine Topology Agent",
    agentRole: "Machine telemetry diagnostics, cited SOP lookup, and topology edge edits.",
    defaultEnabledForNewSandbox: false,
    skills: [
      {
        id: "machines.live_diagnostics",
        serviceId: "machines",
        name: "Machine Telemetry & Alarms",
        description: "Inspect machine hierarchy, live sensor status, alarms, and 24h readings.",
        tools: [
          "list_machines",
          "get_machine",
          "get_machine_status",
          "get_active_alarms",
          "get_alarm_history",
          "get_recent_readings"
        ]
      },
      {
        id: "machines.sop_citations",
        serviceId: "machines",
        name: "Manuals & SOP Search",
        description: "Search plant manuals, torque specs, and safety procedures.",
        tools: ["search_documents", "get_document_section"]
      },
      {
        id: "machines.topology_edit",
        serviceId: "machines",
        name: "Topology & Criticality Edits",
        description: "Update machine criticality tiers and topology utility connections.",
        tools: [],
        changeTypes: ["machine_connection", "machine_criticality"]
      }
    ],
    allowedTools: [
      "list_machines",
      "get_machine",
      "get_machine_status",
      "get_active_alarms",
      "get_alarm_history",
      "get_recent_readings",
      "search_documents",
      "get_document_section"
    ],
    allowedChangeTypes: ["machine_connection", "machine_criticality"]
  },
  {
    id: "monitoring",
    name: "Monitoring & Alerts",
    shortName: "Monitoring",
    href: "/monitoring",
    group: "operations",
    tag: "Alerts + Rules",
    description: "Real-time alert events, threshold rules, and acknowledge/resolve lifecycle.",
    agentId: "agent-monitoring",
    agentName: "Monitoring & Alerts Agent",
    agentRole: "Inspect alert feeds, acknowledge active alerts, and tune threshold rules.",
    defaultEnabledForNewSandbox: false,
    skills: [
      {
        id: "monitoring.alert_triage",
        serviceId: "monitoring",
        name: "Alert Stream Triage",
        description: "List active alert rules and evaluate triggered alert events.",
        tools: ["paas.list_alerts"]
      },
      {
        id: "monitoring.alert_ack",
        serviceId: "monitoring",
        name: "Alert Acknowledgement",
        description: "Acknowledge active monitoring alerts with confirmation.",
        tools: ["paas.acknowledge_alert"]
      },
      {
        id: "monitoring.threshold_tuning",
        serviceId: "monitoring",
        name: "Threshold Rule Tuning",
        description: "Adjust alert rule thresholds in workspace configuration.",
        tools: [],
        changeTypes: ["alert_rule"]
      }
    ],
    allowedTools: ["paas.list_alerts", "paas.acknowledge_alert"],
    allowedChangeTypes: ["alert_rule"]
  },
  {
    id: "notifications",
    name: "Topics & Notifications",
    shortName: "Notifications",
    href: "/notifications",
    group: "messaging",
    tag: "Pub/Sub Topics",
    description: "Event fan-out topics, subscription routing, and workspace notification feed.",
    agentId: "agent-notifications",
    agentName: "Notifications Agent",
    agentRole: "Publish topic notifications within the Notifications service.",
    defaultEnabledForNewSandbox: false,
    skills: [
      {
        id: "notifications.topic_publish",
        serviceId: "notifications",
        name: "Topic Broadcast",
        description: "Publish governed notifications to pub/sub topics.",
        tools: ["paas.publish_notification"]
      }
    ],
    allowedTools: ["paas.publish_notification"],
    allowedChangeTypes: []
  },
  {
    id: "queues",
    name: "Dispatch Queues",
    shortName: "Queues",
    href: "/queues",
    group: "messaging",
    tag: "Queues + DLQ",
    description: "Durable dispatch queues with visibility timeouts, retries, and dead-letter routing.",
    agentId: "agent-queues",
    agentName: "Queues Agent",
    agentRole: "Inspect dispatch queue depths, in-flight locks, and dead-letter counts.",
    defaultEnabledForNewSandbox: false,
    skills: [
      {
        id: "queues.depth_inspect",
        serviceId: "queues",
        name: "Queue & DLQ Inspection",
        description: "Inspect queue depths, in-flight messages, and dead-letter queues.",
        tools: ["paas.inspect_queues"]
      }
    ],
    allowedTools: ["paas.inspect_queues"],
    allowedChangeTypes: []
  }
];

export const SANDBOX_SERVICE_MAP: Readonly<Record<SandboxServiceId, SandboxServiceDefinition>> =
  Object.fromEntries(SANDBOX_SERVICE_CATALOG.map((s) => [s.id, s])) as Record<
    SandboxServiceId,
    SandboxServiceDefinition
  >;

export function isSandboxServiceId(value: string): value is SandboxServiceId {
  return Object.prototype.hasOwnProperty.call(SANDBOX_SERVICE_MAP, value);
}

export function getSandboxServiceDefinition(serviceId: SandboxServiceId): SandboxServiceDefinition {
  return SANDBOX_SERVICE_MAP[serviceId];
}

export function validateServiceSkillIds(
  serviceId: SandboxServiceId,
  skillIds: string[]
): { valid: boolean; invalidSkills: string[]; normalized: string[] } {
  const def = SANDBOX_SERVICE_MAP[serviceId];
  const validSet = new Set(def.skills.map((s) => s.id));
  const invalidSkills: string[] = [];
  const seen = new Set<string>();
  for (const id of skillIds) {
    if (!validSet.has(id)) {
      invalidSkills.push(id);
    } else {
      seen.add(id);
    }
  }
  return {
    valid: invalidSkills.length === 0,
    invalidSkills,
    normalized: Array.from(seen)
  };
}

export function resolveServiceIdFromPathname(pathname: string): AgentScopeId {
  if (!pathname || pathname === "/") return "overview";
  if (pathname.startsWith("/board")) return "board";
  if (pathname.startsWith("/machines") || pathname.startsWith("/m/")) return "machines";
  if (pathname.startsWith("/monitoring")) return "monitoring";
  if (pathname.startsWith("/dashboards")) return "dashboards";
  if (pathname.startsWith("/workflows")) return "workflows";
  if (pathname.startsWith("/connectors")) return "connectors";
  if (pathname.startsWith("/notifications")) return "notifications";
  if (pathname.startsWith("/queues")) return "queues";
  return "overview";
}

export function buildVirtualDefaultSandboxServices(): TenantSandboxServiceView[] {
  return SANDBOX_SERVICE_CATALOG.map((def, idx) => ({
    ...def,
    enabled: true,
    pinnedToDashboard: true,
    enabledSkills: def.skills.map((sk) => sk.id),
    agentInstructions: "",
    displayOrder: idx
  }));
}

export function computeAgentCapabilities(
  services: ReadonlyArray<TenantSandboxServiceView>,
  scopeId: AgentScopeId
): AgentCapabilities {
  const enabledServices = services.filter((s) => s.enabled);
  const disabledServiceIds = services.filter((s) => !s.enabled).map((s) => s.id);

  if (scopeId === "overview") {
    const activeSkills: ServiceSkillDefinition[] = [];
    const allowedToolNames = new Set<string>();
    const allowedChangeTypes = new Set<ChangeTargetType>();

    for (const svc of enabledServices) {
      const enabledSkillSet = new Set(svc.enabledSkills);
      for (const sk of svc.skills) {
        if (!enabledSkillSet.has(sk.id)) continue;
        activeSkills.push(sk);
        for (const t of sk.tools) allowedToolNames.add(t);
        for (const ct of sk.changeTypes ?? []) allowedChangeTypes.add(ct);
      }
    }

    return {
      scopeId: "overview",
      agentId: "agent-overview",
      agentName: "Overview Agent",
      isOverview: true,
      enabled: true,
      activeServiceIds: enabledServices.map((s) => s.id),
      disabledServiceIds,
      activeSkills,
      allowedToolNames,
      allowedChangeTypes
    };
  }

  const target = services.find((s) => s.id === scopeId) ?? {
    ...SANDBOX_SERVICE_MAP[scopeId],
    enabled: false,
    pinnedToDashboard: false,
    enabledSkills: [],
    agentInstructions: "",
    displayOrder: 0
  };

  if (!target.enabled) {
    return {
      scopeId,
      agentId: target.agentId,
      agentName: target.agentName,
      isOverview: false,
      enabled: false,
      activeServiceIds: [],
      disabledServiceIds,
      activeSkills: [],
      allowedToolNames: new Set(),
      allowedChangeTypes: new Set()
    };
  }

  const enabledSkillSet = new Set(target.enabledSkills);
  const activeSkills = target.skills.filter((sk) => enabledSkillSet.has(sk.id));
  const allowedToolNames = new Set<string>();
  const allowedChangeTypes = new Set<ChangeTargetType>();

  for (const sk of activeSkills) {
    for (const t of sk.tools) allowedToolNames.add(t);
    for (const ct of sk.changeTypes ?? []) allowedChangeTypes.add(ct);
  }

  return {
    scopeId,
    agentId: target.agentId,
    agentName: target.agentName,
    isOverview: false,
    enabled: true,
    activeServiceIds: [target.id],
    disabledServiceIds,
    activeSkills,
    allowedToolNames,
    allowedChangeTypes
  };
}
