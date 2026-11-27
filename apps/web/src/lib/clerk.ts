import {
  and,
  eq,
  getLicenseStatus,
  isNull,
  RoleSchema,
  userPlants,
  users,
  withTenantScope,
  type LuticDatabase,
  type SessionUser
} from "@lutic/core";
import { getWebAdministrativeDb, withWebTenantDb } from "./db";
import { provisionTenantWorkspace } from "./tenant-provisioning";

export interface ClerkIdentityInput {
  externalAuthId: string;
  email: string;
  emailVerified: boolean;
  name?: string | null;
}

export function isClerkEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
      process.env.CLERK_SECRET_KEY?.trim()
  );
}

export async function isEnterpriseDeployment(db: LuticDatabase): Promise<boolean> {
  if (process.env.LUTIC_DEPLOYMENT_PLAN?.trim().toLowerCase() === "enterprise") {
    return true;
  }
  const license = await getLicenseStatus(db);
  return license.active && license.plan.toLowerCase().includes("enterprise");
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === "23505" || e.cause?.code === "23505";
}

export async function resolveClerkSessionUser(
  identity: ClerkIdentityInput,
  deps?: {
    db?: LuticDatabase;
    withTenantDb?: <T>(
      tenantId: string,
      fn: (db: LuticDatabase) => Promise<T>
    ) => Promise<T>;
  }
): Promise<SessionUser | null> {
  const externalAuthId = identity.externalAuthId.trim();
  const email = identity.email.trim().toLowerCase();
  if (!externalAuthId || !email) return null;

  const displayName = identity.name?.trim() || email.split("@")[0] || "Lutic User";
  const db = deps?.db ?? (await getWebAdministrativeDb());
  const runTenantDb =
    deps?.withTenantDb ??
    (deps?.db
      ? <T,>(tenantId: string, fn: (tdb: LuticDatabase) => Promise<T>) =>
          withTenantScope(deps.db!, tenantId, fn)
      : withWebTenantDb);

  let dbUser = (
    await db
      .select()
      .from(users)
      .where(eq(users.externalAuthId, externalAuthId))
      .limit(1)
  )[0];

  if (!dbUser) {
    // Unverified emails must never link to existing accounts or shadow-provision a workspace.
    if (identity.emailVerified !== true) return null;

    const emailRows = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(2);

    if (emailRows.length > 1) return null;

    if (emailRows.length === 1) {
      const candidate = emailRows[0];
      if (!candidate || !candidate.active) return null;
      if (candidate.externalAuthId && candidate.externalAuthId !== externalAuthId) {
        return null;
      }
      const linked = await db
        .update(users)
        .set({ externalAuthId })
        .where(and(eq(users.id, candidate.id), isNull(users.externalAuthId)))
        .returning();
      dbUser = linked[0];
      if (!dbUser) {
        const reloaded = await db
          .select()
          .from(users)
          .where(eq(users.id, candidate.id))
          .limit(1);
        if (reloaded[0]?.externalAuthId === externalAuthId) {
          dbUser = reloaded[0];
        } else {
          return null;
        }
      }
    } else {
      if (await isEnterpriseDeployment(db)) {
        return null;
      }

      try {
        const provisioned = await provisionTenantWorkspace(db, {
          email,
          name: displayName,
          passwordHash: "clerk-managed-no-local-password",
          externalAuthId,
          authSource: "auth.clerk_provision"
        });
        dbUser = provisioned.userRow;
      } catch (err) {
        if (!isUniqueConstraintError(err)) throw err;
        dbUser = (
          await db
            .select()
            .from(users)
            .where(eq(users.externalAuthId, externalAuthId))
            .limit(1)
        )[0];
      }
    }
  }

  if (!dbUser || !dbUser.active) return null;

  return runTenantDb(dbUser.tenantId, async (tdb) => {
    const scopedRows = await tdb
      .select()
      .from(users)
      .where(and(eq(users.id, dbUser.id), eq(users.tenantId, dbUser.tenantId)))
      .limit(1);
    const scopedUser = scopedRows[0];
    if (!scopedUser || !scopedUser.active) return null;

    const roleParsed = RoleSchema.safeParse(scopedUser.role);
    if (!roleParsed.success) return null;

    const plantRows = await tdb
      .select({ plantId: userPlants.plantId })
      .from(userPlants)
      .where(
        and(
          eq(userPlants.userId, scopedUser.id),
          eq(userPlants.tenantId, scopedUser.tenantId)
        )
      );

    return {
      userId: scopedUser.id,
      tenantId: scopedUser.tenantId,
      role: roleParsed.data,
      plantIds: plantRows.map((p) => p.plantId),
      email: scopedUser.email,
      name: scopedUser.name
    };
  });
}

export async function getClerkServerSessionUser(): Promise<SessionUser | null> {
  if (!isClerkEnabled()) return null;
  try {
    const { auth, currentUser } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    if (!userId) return null;
    const clerkUser = await currentUser();
    if (!clerkUser) return null;

    const primary =
      clerkUser.emailAddresses.find(
        (addr) => addr.id === clerkUser.primaryEmailAddressId
      ) ?? clerkUser.emailAddresses[0];
    if (!primary?.emailAddress) return null;

    const emailVerified = primary.verification?.status === "verified";
    const fullName =
      clerkUser.fullName?.trim() ||
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
      null;

    return await resolveClerkSessionUser({
      externalAuthId: userId,
      email: primary.emailAddress,
      emailVerified,
      name: fullName
    });
  } catch {
    return null;
  }
}
