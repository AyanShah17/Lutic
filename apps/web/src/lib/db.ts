import {
  and,
  dashboardVersions,
  desc,
  eq,
  getDbConnection,
  inArray,
  requireLicense,
  seedDatabase,
  sql,
  withTenantScope,
  type LuticDatabase
} from "@lutic/core";

let initPromise: Promise<LuticDatabase> | null = null;

export async function getWebAdministrativeDb(): Promise<LuticDatabase> {
  if (!initPromise) {
    initPromise = (async () => {
      const conn = await getDbConnection();
      if (process.env.NODE_ENV === "production") {
        await conn.db.execute(sql`SELECT 1 FROM tenants LIMIT 1`);
      } else {
        await seedDatabase(conn);
      }
      void import("./runtime")
        .then((m) => m.ensureBackgroundRuntime())
        .catch(() => {});
      return conn.db;
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

export async function getWebDbConnection() {
  await getWebAdministrativeDb();
  return getDbConnection();
}

export async function withWebTenantDb<T>(
  tenantId: string,
  fn: (db: LuticDatabase) => Promise<T>
): Promise<T> {
  return withTenantScope(await getWebAdministrativeDb(), tenantId, fn);
}

export async function requireWebLicense(): Promise<void> {
  await requireLicense(await getWebAdministrativeDb());
}

export async function pruneDashboardVersions(
  db: LuticDatabase,
  dashboardId: string,
  tenantId: string,
  maxVersions = 5
): Promise<void> {
  const rows = await db
    .select({ id: dashboardVersions.id })
    .from(dashboardVersions)
    .where(
      and(
        eq(dashboardVersions.dashboardId, dashboardId),
        eq(dashboardVersions.tenantId, tenantId)
      )
    )
    .orderBy(desc(dashboardVersions.version));

  const staleIds = rows.slice(maxVersions).map((r) => r.id);
  if (staleIds.length > 0) {
    await db
      .delete(dashboardVersions)
      .where(
        and(
          eq(dashboardVersions.dashboardId, dashboardId),
          eq(dashboardVersions.tenantId, tenantId),
          inArray(dashboardVersions.id, staleIds)
        )
      );
  }
}
