import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Cpu,
  GitBranch,
  Kanban,
  KeyRound,
  Layers,
  Plug,
  QrCode,
  ShieldCheck
} from "lucide-react";
import {
  alarms,
  alertEvents,
  and,
  assets,
  can,
  eq,
  inArray,
  isDemoMode,
  isNull,
  machineStatus,
  notifications,
  workflows
} from "@lutic/core";
import { getSessionUser } from "@/lib/auth";
import { withWebTenantDb } from "@/lib/db";
import { isNavItemVisible } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GlowBorderCard } from "@/components/vengeance/glow-border-card";
import { LineHoverLink } from "@/components/vengeance/line-hover-link";
import { LuticLandingPage } from "@/components/landing-page";

interface ModuleItem {
  id: string;
  href: string;
  title: string;
  description: string;
  tag: string;
  Icon: React.ComponentType<{ className?: string }>;
}

interface ModuleGroup {
  code: string;
  title: string;
  subtitle: string;
  items: ModuleItem[];
}

export default async function HomePage() {
  const user = await getSessionUser();
  const demoMode = isDemoMode();

  if (!user) {
    return <LuticLandingPage demoMode={demoMode} />;
  }

  let snapshot: {
    totalMachines: number;
    runningMachines: number;
    faultMachines: number;
    openAlerts: number | null;
    enabledWorkflows: number | null;
    unreadNotifications: number | null;
    spotlightMachine: {
      id: string;
      name: string;
      plantId: string;
      code: string;
      message: string;
    } | null;
  } | null = null;

  if (user && user.plantIds.length > 0) {
    try {
      snapshot = await withWebTenantDb(user.tenantId, async (db) => {
        const [machineRows, alarmRows, wfRows, alertRows, notifRows] = await Promise.all([
          db
            .select({
              id: assets.id,
              name: assets.name,
              plantId: assets.plantId,
              status: machineStatus.status
            })
            .from(assets)
            .leftJoin(machineStatus, eq(machineStatus.machineId, assets.id))
            .where(
              and(
                eq(assets.tenantId, user.tenantId),
                eq(assets.type, "machine"),
                inArray(assets.plantId, user.plantIds)
              )
            ),
          db
            .select({
              machineId: alarms.machineId,
              code: alarms.code,
              message: alarms.message,
              plantId: alarms.plantId
            })
            .from(alarms)
            .where(
              and(
                eq(alarms.tenantId, user.tenantId),
                inArray(alarms.plantId, user.plantIds),
                isNull(alarms.clearedAt)
              )
            ),
          can(user, "workflow:read")
            ? db
                .select({ id: workflows.id, enabled: workflows.enabled })
                .from(workflows)
                .where(eq(workflows.tenantId, user.tenantId))
            : Promise.resolve(null),
          can(user, "alert:read")
            ? db
                .select({ id: alertEvents.id, status: alertEvents.status })
                .from(alertEvents)
                .where(eq(alertEvents.tenantId, user.tenantId))
            : Promise.resolve(null),
          can(user, "notification:read")
            ? db
                .select({ id: notifications.id })
                .from(notifications)
                .where(
                  and(
                    eq(notifications.tenantId, user.tenantId),
                    eq(notifications.read, false)
                  )
                )
            : Promise.resolve(null)
        ]);

        const e42Alarm = alarmRows.find((a) => a.code === "E42") ?? alarmRows[0] ?? null;
        const spotlightAsset = e42Alarm
          ? machineRows.find((m) => m.id === e42Alarm.machineId)
          : machineRows.find((m) => m.status === "fault") ?? machineRows[0];

        return {
          totalMachines: machineRows.length,
          runningMachines: machineRows.filter((m) => m.status === "running").length,
          faultMachines: machineRows.filter((m) => m.status === "fault").length,
          openAlerts: alertRows ? alertRows.filter((a) => a.status === "ALARM").length : null,
          enabledWorkflows: wfRows ? wfRows.filter((w) => w.enabled).length : null,
          unreadNotifications: notifRows ? notifRows.length : null,
          spotlightMachine: spotlightAsset
            ? {
                id: spotlightAsset.id,
                name: spotlightAsset.name,
                plantId: spotlightAsset.plantId,
                code: e42Alarm?.code ?? (spotlightAsset.status === "fault" ? "FAULT" : "LIVE"),
                message:
                  e42Alarm?.message ??
                  `Active equipment workspace scoped to ${spotlightAsset.plantId}.`
              }
            : null
        };
      });
    } catch {
      snapshot = null;
    }
  }

  const rawGroups: ModuleGroup[] = [
    {
      code: "01",
      title: "Operations",
      subtitle: "Diagnostics, equipment health, and threshold alerting",
      items: [
        {
          id: "board",
          href: "/board",
          title: "Operations & AI Board",
          description:
            "Track incidents, SAP/ServiceNow escalations, AI automations, and plant tasks across Backlog to Done.",
          tag: "Kanban + List",
          Icon: Kanban
        },
        {
          id: "machines",
          href: "/machines",
          title: "Machine Fleet & Topology",
          description:
            "Interactive document-grounded machine connections canvas with colored groups and QR diagnostic workspaces.",
          tag: "ISA-95 Canvas",
          Icon: Cpu
        },
        {
          id: "monitoring",
          href: "/monitoring",
          title: "Monitoring & Alerts",
          description:
            "Telemetry time-series, threshold alarm rules, and acknowledge/resolve lifecycle.",
          tag: "Lutic Monitor",
          Icon: Activity
        }
      ]
    },
    {
      code: "02",
      title: "Automation & Data",
      subtitle: "Declarative dashboards, DAG workflows, and OT/IT connectors",
      items: [
        {
          id: "dashboards",
          href: "/dashboards",
          title: "Semantic Dashboards",
          description:
            "AI-assisted KPI boards with client undo/redo, 5-version history, and RBAC widget locks.",
          tag: "No SQL",
          Icon: BarChart3
        },
        {
          id: "workflows",
          href: "/workflows",
          title: "Workflows & Builder",
          description:
            "Visual node/edge automation canvas with keyword draft generation and step trace logs.",
          tag: "DAG",
          Icon: GitBranch
        },
        {
          id: "connectors",
          href: "/connectors",
          title: "Connectors Hub",
          description:
            "Unified Lutic Connector Hub (SAP, AWS, ServiceNow, MQTT, OPC-UA, Modbus), Lutic AI Gateway, and governed tool execution.",
          tag: "Lutic Protocol",
          Icon: Plug
        }
      ]
    },
    {
      code: "03",
      title: "Messaging",
      subtitle: "Event fan-out topics and Lutic dispatch queues",
      items: [
        {
          id: "notifications",
          href: "/notifications",
          title: "Topics & Notifications",
          description:
            "Lutic pub/sub fan-out topics, subscription routing, and operational notification feed.",
          tag: "Lutic Topics",
          Icon: Bell
        },
        {
          id: "queues",
          href: "/queues",
          title: "Dispatch Queues",
          description:
            "Lutic maintenance dispatch queues with visibility timeouts, retries, and dead-letter routing.",
          tag: "Lutic Queues",
          Icon: Layers
        }
      ]
    },
    {
      code: "04",
      title: "Governance",
      subtitle: "IAM permissions, knowledge revisions, audit logs, and licensing",
      items: [
        {
          id: "admin",
          href: "/admin",
          title: "IAM & Admin Console",
          description:
            "Role-based permissions, AES-256-GCM credentials, toolkits, knowledge ingestion, and audit logs.",
          tag: "RBAC",
          Icon: ShieldCheck
        },
        {
          id: "activate",
          href: "/activate",
          title: "License Activation",
          description:
            "Manage instance activation keys and online verification against the license server.",
          tag: "License",
          Icon: KeyRound
        }
      ]
    }
  ];

  const groups = rawGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isNavItemVisible(user, item.id))
    }))
    .filter((group) => group.items.length > 0);

  const primaryMachineHref = snapshot?.spotlightMachine
    ? `/m/${snapshot.spotlightMachine.id}`
    : "/machines";
  const primaryMachineLabel = snapshot?.spotlightMachine
    ? `${snapshot.spotlightMachine.name} (${snapshot.spotlightMachine.code})`
    : "Browse Machine Fleet";

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 space-y-7">
      <section className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between border-b border-border/70 pb-6">
        <div className="space-y-1.5 max-w-2xl">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            <span className="capitalize">
              {user ? `${user.role} · ${user.plantIds.join(", ")}` : "Lutic Operations Platform"}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
            Lutic Industrial Operations PaaS
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Role-governed AI guidance, machine topology, workflow automation, live telemetry, and semantic dashboards.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {user ? (
            <>
              <Link href="/machines" className={buttonVariants({ size: "default" })}>
                <Cpu className="h-4 w-4" />
                <span>Machine Topology</span>
              </Link>
              <Link
                href={primaryMachineHref}
                className={buttonVariants({ variant: "outline", size: "default" })}
              >
                <QrCode className="h-4 w-4" />
                <span>{primaryMachineLabel}</span>
              </Link>
            </>
          ) : (
            <Link href="/login" className={buttonVariants({ size: "default" })}>
              <span>{demoMode ? "Sign in with Demo Role" : "Sign in"}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </section>

      {snapshot && (
        <section
          aria-label="Operational Snapshot"
          className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border/70 rounded-2xl border border-border/80 bg-card overflow-hidden"
        >
          <div className="p-4">
            <div className="text-xs font-medium text-muted-foreground">
              Fleet Running
            </div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums">
              {snapshot.runningMachines}
              <span className="text-xs font-normal text-muted-foreground">
                /{snapshot.totalMachines}
              </span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs font-medium text-muted-foreground">
              Active Faults
            </div>
            <div
              className={cn(
                "mt-1 text-xl font-semibold font-mono tabular-nums",
                snapshot.faultMachines > 0 ? "text-destructive" : "text-foreground"
              )}
            >
              {snapshot.faultMachines}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs font-medium text-muted-foreground">
              Open Alerts
            </div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums">
              {snapshot.openAlerts ?? "—"}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs font-medium text-muted-foreground">
              Active Workflows
            </div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums">
              {snapshot.enabledWorkflows ?? "—"}
            </div>
          </div>
        </section>
      )}

      {((!user && demoMode) || snapshot?.spotlightMachine) && (
        <GlowBorderCard>
          <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">
                    {snapshot?.spotlightMachine
                      ? `Spotlight: ${snapshot.spotlightMachine.name}`
                      : "Live Active Fault: Line 3 Rotary Filler #1"}
                  </span>
                  <Badge variant="destructive" className="font-mono">
                    {snapshot?.spotlightMachine?.code ?? "E42"}
                  </Badge>
                  <Badge variant="outline" className="font-mono">
                    {snapshot?.spotlightMachine?.plantId ?? "plant-detroit"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground max-w-2xl">
                  {snapshot?.spotlightMachine?.message ??
                    "Vibration anomaly and active fault E42 seeded on Detroit Line 3. Inspect live telemetry, cited Rev 4.2 torque specifications, parts stock, and repair history."}
                </p>
              </div>
            </div>

            <LineHoverLink
              href={user ? primaryMachineHref : "/login"}
              className="shrink-0 py-1 font-medium"
            >
              {user
                ? `Inspect ${snapshot?.spotlightMachine?.id ?? "mach-l3-filler-01"}`
                : "Sign in to Inspect"}
              <ArrowRight className="h-3.5 w-3.5" />
            </LineHoverLink>
          </div>
        </GlowBorderCard>
      )}

      <section className="space-y-6">
        {groups.map((group) => (
          <div key={group.code} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-0.5">
              <h2 className="text-xs font-medium text-muted-foreground">{group.title}</h2>
              <span className="text-[11px] text-muted-foreground/80">{group.subtitle}</span>
            </div>

            <Card className="divide-y divide-border/60 overflow-hidden rounded-2xl">
              {group.items.map(({ href, title, description, tag, Icon }) => (
                <Link
                  key={href + title}
                  href={href}
                  className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-muted/30"
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5 sm:mt-0 transition-colors duration-150" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors duration-150">
                          {title}
                        </span>
                        <span className="text-[11px] font-mono text-muted-foreground/80">
                          {tag}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate sm:whitespace-normal">
                        {description}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-primary group-hover:translate-x-0.5 transition-[color,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] shrink-0 hidden sm:block" />
                </Link>
              ))}
            </Card>
          </div>
        ))}
      </section>
    </div>
  );
}
