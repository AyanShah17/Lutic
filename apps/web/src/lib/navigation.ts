import { can, type SessionUser } from "@kojo/core/rbac";

export interface NavItemConfig {
  id: string;
  href: string;
  labelKey: string;
  keywords: string[];
  groupId: "operations" | "automation" | "messaging" | "governance";
}

export interface NavGroupConfig {
  id: "operations" | "automation" | "messaging" | "governance";
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
        id: "chat",
        href: "/chat",
        labelKey: "nav.chat",
        keywords: ["ai", "chat", "assistant", "manuals", "diagnostics", "ask kojo"],
        groupId: "operations"
      },
      {
        id: "machines",
        href: "/machines",
        labelKey: "nav.machines",
        keywords: ["machines", "assets", "qr", "equipment", "line", "fault"],
        groupId: "operations"
      },
      {
        id: "monitoring",
        href: "/monitoring",
        labelKey: "nav.monitoring",
        keywords: ["monitoring", "kojo monitor", "alerts", "alarms", "telemetry", "rules"],
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
        keywords: ["connectors", "mcp", "scada", "cmms", "erp", "kojo", "code mode"],
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
  },
  {
    id: "governance",
    labelKey: "nav.group.governance",
    items: [
      {
        id: "admin",
        href: "/admin",
        labelKey: "nav.admin",
        keywords: ["admin", "iam", "rbac", "users", "toolkits", "knowledge", "audit", "usage"],
        groupId: "governance"
      },
      {
        id: "activate",
        href: "/activate",
        labelKey: "nav.license",
        keywords: ["license", "activate", "key", "billing"],
        groupId: "governance"
      }
    ]
  }
];

export function isNavItemVisible(user: SessionUser | null, id: string): boolean {
  switch (id) {
    case "overview":
      return true;
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
      return Boolean(user && (can(user, "admin:users") || can(user, "license:manage")));
    case "activate":
      return Boolean(user && can(user, "license:manage"));
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
