import {
  alarms,
  alertEvents,
  and,
  assets,
  buildVirtualDefaultSandboxServices,
  can,
  computeAgentCapabilities,
  eq,
  getTenantSandboxServices,
  inArray,
  isDemoMode,
  isNull,
  machineStatus,
  notifications,
  workflows,
  type TenantSandboxServiceView
} from "@lutic/core";
import { getSessionUser } from "@/lib/auth";
import { withWebTenantDb } from "@/lib/db";
import { LuticLandingPage } from "@/components/landing-page";
import { SandboxDashboard, type WorkspaceSnapshot } from "@/components/sandbox-dashboard";

export default async function HomePage() {
  const user = await getSessionUser();
  const demoMode = isDemoMode();

  if (!user) {
    return <LuticLandingPage demoMode={demoMode} />;
  }

  let snapshot: WorkspaceSnapshot | null = null;
  let initialServices: TenantSandboxServiceView[] = buildVirtualDefaultSandboxServices();

  try {
    const loaded = await withWebTenantDb(user.tenantId, async (db) => {
      const svcs = await getTenantSandboxServices(db, user.tenantId);
      let snap: WorkspaceSnapshot | null = null;

      if (user.plantIds.length > 0) {
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

        snap = {
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
      }
      return { svcs, snap };
    });
    initialServices = loaded.svcs;
    snapshot = loaded.snap;
  } catch {
    snapshot = null;
  }

  const overviewCaps = computeAgentCapabilities(initialServices, "overview");
  const primaryMachineHref = snapshot?.spotlightMachine
    ? `/m/${snapshot.spotlightMachine.id}`
    : "/machines";
  const primaryMachineLabel = snapshot?.spotlightMachine
    ? `${snapshot.spotlightMachine.name} (${snapshot.spotlightMachine.code})`
    : "Browse Machine Fleet";

  return (
    <SandboxDashboard
      user={user}
      snapshot={snapshot}
      initialServices={initialServices}
      initialOverviewAgent={{
        scopeId: "overview",
        agentId: overviewCaps.agentId,
        agentName: overviewCaps.agentName,
        activeServiceIds: overviewCaps.activeServiceIds,
        disabledServiceIds: overviewCaps.disabledServiceIds,
        activeSkills: overviewCaps.activeSkills.map((s) => s.id)
      }}
      primaryMachineHref={primaryMachineHref}
      primaryMachineLabel={primaryMachineLabel}
    />
  );
}
