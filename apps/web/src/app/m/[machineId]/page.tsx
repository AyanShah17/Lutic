import Link from "next/link";
import {
  alarms,
  and,
  assets,
  AuthorizationError,
  authorize,
  desc,
  eq,
  isNull,
  machineStatus,
  plants
} from "@lutic/core";
import { getSessionUser } from "@/lib/auth";
import { withWebTenantDb } from "@/lib/db";
import { ChatWorkspace, type MachineHeaderInfo } from "@/components/chat-workspace";

export default async function MachineChatPage({
  params: pendingParams
}: {
  params: Promise<{ machineId: string }>;
}) {
  const params = await pendingParams;
  const user = await getSessionUser();
  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center space-y-4">
        <h1 className="text-xl font-bold">Sign in for Machine Diagnostics</h1>
        <p className="text-sm text-muted-foreground">
          Machine QR endpoint <code>/m/{params.machineId}</code> requires authentication.
        </p>
        <Link
          href="/login"
          className="inline-flex rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground min-h-[44px]"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return withWebTenantDb(user.tenantId, async (db) => {
    const machineRows = await db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.id, params.machineId),
          eq(assets.tenantId, user.tenantId)
        )
      )
      .limit(1);

    const machine = machineRows[0];
    if (!machine) {
      return (
        <div className="mx-auto max-w-xl px-4 py-12 text-center space-y-3">
          <h1 className="text-xl font-bold">Machine Not Found</h1>
          <p className="text-sm text-muted-foreground">
            No machine with ID <code>{params.machineId}</code> exists in your tenant.
          </p>
          <Link href="/machines" className="underline text-sm font-semibold text-primary">
            Return to Machines
          </Link>
        </div>
      );
    }

    try {
      authorize(user, "machine:read", {
        tenantId: machine.tenantId,
        plantId: machine.plantId
      });
    } catch (err) {
      const msg =
        err instanceof AuthorizationError
          ? err.message
          : "Not authorized for this machine's plant.";
      return (
        <div className="mx-auto max-w-xl px-4 py-12 text-center space-y-3">
          <h1 className="text-xl font-bold text-red-700">Plant Access Denied</h1>
          <p className="text-sm text-muted-foreground">{msg}</p>
          <Link href="/machines" className="underline text-sm font-semibold text-primary">
            View your authorized machines
          </Link>
        </div>
      );
    }

    const [statusRows, activeAlarms, plantRows] = await Promise.all([
      db
        .select()
        .from(machineStatus)
        .where(eq(machineStatus.machineId, machine.id))
        .limit(1),
      db
        .select()
        .from(alarms)
        .where(
          and(
            eq(alarms.machineId, machine.id),
            eq(alarms.tenantId, user.tenantId),
            isNull(alarms.clearedAt)
          )
        )
        .orderBy(desc(alarms.raisedAt)),
      db
        .select({ name: plants.name, timezone: plants.timezone })
        .from(plants)
        .where(and(eq(plants.id, machine.plantId), eq(plants.tenantId, user.tenantId)))
        .limit(1)
    ]);

    const status = statusRows[0];
    const plant = plantRows[0];
    const headerInfo: MachineHeaderInfo = {
      id: machine.id,
      name: machine.name,
      machineType: machine.machineType,
      manufacturer: machine.manufacturer,
      model: machine.model,
      serialNo: machine.serialNo,
      plantId: machine.plantId,
      plantName: plant?.name,
      plantTimezone: plant?.timezone,
      status: status?.status ?? "offline",
      updatedAt: status?.updatedAt?.toISOString() ?? null,
      temperature: status?.temperature ?? null,
      vibration: status?.vibration ?? null,
      activeAlarms: activeAlarms.map((a) => ({
        code: a.code,
        severity: a.severity,
        message: a.message
      }))
    };

    return <ChatWorkspace machineHeader={headerInfo} />;
  });
}
