import { can, type SessionUser } from "@lutic/core/rbac";

export interface NavItemConfig {
  id: string;
  href: string;
  labelKey: string;
  keywords: string[];
  groupId: "operations" | "automation" | "messaging";
}

export interface NavGroupConfig {
  id: "operations" | "automation" | "messaging";
  labelKey: string;
  items: NavItemConfig[];
}

const NAV_GROUPS: NavGroupConfig[] = [
  {
    id: "operations",
    labelKey: "nav.group.operations",
    items: [
      {
        id: "overview",
        href: "/",
        labelKey: "nav.overview",
        keywords: ["home", "overview", "launchpad", "summary"],
        groupId: "operations"
      },
      {
        id: "board",
        href: "/board",
        labelKey: "nav.board",
        keywords: ["board", "jira", "linear", "kanban", "issues", "tasks", "sprint"],
        groupId: "operations"
      },
      {
        id: "machines",
        href: "/machines",
        labelKey: "nav.machines",
        keywords: ["machines", "assets", "qr", "equipment", "line", "fault", "topology", "canvas"],
        groupId: "operations"
      },
      {
        id: "monitoring",
        href: "/monitoring",
        labelKey: "nav.monitoring",
        keywords: ["monitoring", "lutic monitor", "alerts", "alarms", "telemetry", "rules"],
        groupId: "operations"
      }
    ]
  },
  {
    id: "automation",
    labelKey: "nav.group.automation",
    items: [
      {
        id: "dashboards",
        href: "/dashboards",
        labelKey: "nav.dashboards",
        keywords: ["dashboards", "analytics", "oee", "downtime", "charts", "kpi"],
        groupId: "automation"
      },
      {
        id: "workflows",
        href: "/workflows",
        labelKey: "nav.workflows",
        keywords: ["workflows", "canvas", "automation", "dag", "builder"],
        groupId: "automation"
      },
      {
        id: "connectors",
        href: "/connectors",
        labelKey: "nav.connectors",
        keywords: ["connectors", "mcp", "scada", "cmms", "erp", "lutic", "code mode"],
        groupId: "automation"
      }
    ]
  },
  {
    id: "messaging",
    labelKey: "nav.group.messaging",
    items: [
      {
        id: "notifications",
        href: "/notifications",
        labelKey: "nav.notifications",
        keywords: ["notifications", "topics", "subscriptions", "alerts", "pubsub"],
        groupId: "messaging"
      },
      {
        id: "queues",
        href: "/queues",
        labelKey: "nav.queues",
        keywords: ["queues", "dlq", "dispatch", "messages"],
        groupId: "messaging"
      }
    ]
  }
];

export function isNavItemVisible(user: SessionUser | null, id: string): boolean {
  switch (id) {
    case "overview":
      return true;
    case "board":
      return !user || can(user, "workorder:read");
    case "chat":
      return !user || can(user, "docs:read") || can(user, "machine:read");
    case "machines":
      return !user || can(user, "machine:read");
    case "dashboards":
      return !user || can(user, "dashboard:read");
    case "workflows":
      return !user || can(user, "workflow:read");
    case "connectors":
      return !user || can(user, "connector:read");
    case "monitoring":
      return !user || can(user, "alert:read");
    case "queues":
      return !user || can(user, "queue:read");
    case "notifications":
      return !user || can(user, "notification:read");
    case "admin":
    case "activate":
    default:
      return false;
  }
}

export function getNavGroupsForUser(
  user: SessionUser | null,
  t: (key: string) => string
): Array<{
  id: NavGroupConfig["id"];
  label: string;
  items: Array<NavItemConfig & { label: string }>;
}> {
  return NAV_GROUPS.map((group) => ({
    id: group.id,
    label: t(group.labelKey),
    items: group.items
      .filter((item) => isNavItemVisible(user, item.id))
      .map((item) => ({ ...item, label: t(item.labelKey) }))
  })).filter((g) => g.items.length > 0);
}
