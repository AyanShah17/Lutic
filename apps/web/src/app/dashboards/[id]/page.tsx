import Link from "next/link";
import {
  and,
  authorize,
  can,
  dashboards,
  dashboardShares,
  DashboardSpecSchema,
  eq,
  isDashboardSharedWithUser
} from "@lutic/core";
import { getSessionUser } from "@/lib/auth";
import { withWebTenantDb } from "@/lib/db";
import { DashboardWorkspace } from "@/components/dashboard-workspace";

export default async function DashboardDetailPage({
  params: pendingParams
}: {
  params: Promise<{ id: string }>;
}) {
  const params = await pendingParams;
  const user = await getSessionUser();
  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center space-y-4">
        <h1 className="text-xl font-bold">Sign in Required</h1>
        <Link
          href="/login"
          className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Sign in
        </Link>
      </div>
    );
  }

  authorize(user, "dashboard:read", { tenantId: user.tenantId });
  return withWebTenantDb(user.tenantId, async (db) => {
    const [dashRows, shareRows] = await Promise.all([
      db
        .select()
        .from(dashboards)
        .where(
          and(eq(dashboards.id, params.id), eq(dashboards.tenantId, user.tenantId))
        )
        .limit(1),
      db
        .select()
        .from(dashboardShares)
        .where(
          and(
            eq(dashboardShares.dashboardId, params.id),
            eq(dashboardShares.tenantId, user.tenantId)
          )
        )
    ]);

    const dash = dashRows[0];
    if (!dash) {
      return (
        <div className="mx-auto max-w-xl px-4 py-12 text-center space-y-3">
          <h1 className="text-xl font-bold">Dashboard Not Found</h1>
          <Link href="/dashboards" className="underline text-sm font-semibold text-primary">
            Back to Dashboards
          </Link>
        </div>
      );
    }

    const shares = shareRows.map((s) => ({
      shareType: s.shareType as "role" | "plant",
      targetId: s.targetId
    }));

    if (
      !isDashboardSharedWithUser(user, {
        tenantId: dash.tenantId,
        ownerId: dash.ownerId,
        plantScope: dash.plantScope,
        shares
      })
    ) {
      return (
        <div className="mx-auto max-w-xl px-4 py-12 text-center space-y-3">
          <h1 className="text-xl font-bold text-red-700">Access Denied</h1>
          <p className="text-sm text-muted-foreground">
            This dashboard has not been shared with your role or plants.
          </p>
        </div>
      );
    }

    const spec = DashboardSpecSchema.parse(dash.spec);
    const canEdit =
      can(user, "dashboard:write", { tenantId: dash.tenantId }) &&
      (user.role === "admin" || dash.ownerId === user.userId);

    return (
      <DashboardWorkspace
        dashboardId={dash.id}
        initialSpec={spec}
        canEdit={canEdit}
        initialShares={shares}
      />
    );
  });
}
