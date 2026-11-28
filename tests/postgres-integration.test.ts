import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  and,
  consumeRateLimit,
  createDbConnection,
  ensureSchema,
  eq,
  getAppliedMigrations,
  ingestionTokens,
  isNull,
  runRuntimeTick,
  sql,
  userPlants,
  users,
  withTenantScope,
  type DbConnection
} from "@lutic/core";

// Set only to a dedicated test database; CI supplies an isolated PostgreSQL service.
describe.skipIf(!process.env.POSTGRES_TEST_URL)("PostgreSQL multi-connection isolation", () => {
  let first: DbConnection;
  let second: DbConnection;
  const prefix = `integration-${crypto.randomUUID()}`;
  const alpha = `${prefix}-a`;
  const beta = `${prefix}-b`;
  beforeAll(async () => {
    first = await createDbConnection(process.env.POSTGRES_TEST_URL);
    second = await createDbConnection(process.env.POSTGRES_TEST_URL);
    await ensureSchema(first);
    await first.db.execute(sql`INSERT INTO tenants (id, name, slug) VALUES (${alpha}, 'A', ${alpha}), (${beta}, 'B', ${beta})`);
    await first.db.execute(sql`INSERT INTO plants (id, tenant_id, name, code) VALUES (${alpha}, ${alpha}, 'A', 'A'), (${beta}, ${beta}, 'B', 'B')`);
  });
  afterAll(async () => {
    if (first) {
      await first.db.execute(sql`DELETE FROM tenants WHERE id IN (${alpha}, ${beta})`);
      await first.db.execute(sql`DELETE FROM rate_limits WHERE scope = ${prefix}`);
    }
    await Promise.all([first?.close(), second?.close()]);
  });

  it("isolates simultaneous transactions on separate pools", async () => {
    const rows = await Promise.all([[first, alpha], [second, beta]].map(async ([conn, tenant]) =>
      withTenantScope((conn as DbConnection).db, tenant as string, async (tx) => {
        await tx.execute(sql`SELECT pg_sleep(0.05)`);
        return (await tx.execute(sql`SELECT id FROM plants`)).rows;
      })
    ));
    expect(rows).toEqual([[{ id: alpha }], [{ id: beta }]]);
    const unscoped = await first.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE lutic_app`);
      return (await tx.execute(sql`SELECT id FROM plants`)).rows;
    });
    expect(unscoped).toEqual([]);
  });

  it("enforces a single shared quota across separate application pools", async () => {
    const attempts = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      consumeRateLimit((index % 2 ? first : second).db, { scope: prefix, key: "same-user", limit: 3, windowMs: 60_000 })
    ));
    expect(attempts.filter(Boolean)).toHaveLength(3);
  });

  it("does not run a second runtime tick while another instance holds the lock", async () => {
    await first.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('lutic.runtime'), 1)`);
      const result = await runRuntimeTick(second.db);
      expect(result.skipped).toBe("busy");
      expect(result.telemetryUpdated).toBe(0);
    });
  });

  it("tracks versioned migrations and blocks lutic_app from schema_migrations and cross-tenant ingestion_tokens", async () => {
    const applied = await getAppliedMigrations(first);
    expect(applied.map((m) => m.version)).toEqual([1, 2, 3, 4, 5]);

    await expect(
      first.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE lutic_app`);
        return tx.execute(sql`SELECT version FROM schema_migrations`);
      })
    ).rejects.toThrow();

    await expect(
      first.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE lutic_app`);
        return tx.execute(sql`SELECT worker_id FROM worker_heartbeats`);
      })
    ).rejects.toThrow();

    await first.db.execute(sql`
      INSERT INTO ingestion_tokens (id, tenant_id, plant_id, name, token_prefix, token_hash, created_by)
      VALUES
        ('itok-pg-a', ${alpha}, ${alpha}, 'Alpha GW', 'kjt_alpha', ${`${prefix}-hash-a`}, 'adm-a'),
        ('itok-pg-b', ${beta}, ${beta}, 'Beta GW', 'kjt_beta', ${`${prefix}-hash-b`}, 'adm-b')
    `);

    const scoped = await withTenantScope(second.db, alpha, async (tx) => {
      return (await tx.execute(sql`SELECT id FROM ingestion_tokens`)).rows;
    });
    expect(scoped).toEqual([{ id: "itok-pg-a" }]);
  });

  it("serializes concurrent password change vs admin reset across separate pools with FOR UPDATE and token_version CAS", async () => {
    const uid = `usr-pg-race-${crypto.randomUUID().slice(0, 8)}`;
    await first.db.insert(users).values({
      id: uid,
      tenantId: alpha,
      email: `${uid}@alpha.test`,
      name: "PG Race User",
      passwordHash: "scrypt$00$00",
      role: "engineer",
      active: true,
      tokenVersion: 1
    });

    const attemptCas = async (conn: DbConnection, nextHash: string) =>
      withTenantScope(conn.db, alpha, async (tx) => {
        const [locked] = await tx
          .select()
          .from(users)
          .where(and(eq(users.id, uid), eq(users.tenantId, alpha)))
          .limit(1)
          .for("update");
        if (!locked || locked.tokenVersion !== 1) return false;
        const updated = await tx
          .update(users)
          .set({ passwordHash: nextHash, tokenVersion: sql`${users.tokenVersion} + 1` })
          .where(and(eq(users.id, uid), eq(users.tenantId, alpha), eq(users.tokenVersion, 1)))
          .returning();
        return updated.length === 1;
      });

    const outcomes = await Promise.all([
      attemptCas(first, "scrypt$11$pwchange"),
      attemptCas(second, "scrypt$22$adminreset")
    ]);
    expect(outcomes.sort()).toEqual([false, true]);
    const [row] = await first.db.select().from(users).where(eq(users.id, uid));
    expect(row?.tokenVersion).toBe(2);
  });

  it("permits only one successor on concurrent ingestion token rotations across separate pools", async () => {
    const tokId = `itok-race-${crypto.randomUUID().slice(0, 8)}`;
    await first.db.insert(ingestionTokens).values({
      id: tokId,
      tenantId: alpha,
      plantId: alpha,
      name: "Race GW",
      tokenPrefix: "kjt_race0000",
      tokenHash: `${prefix}-${tokId}`,
      scopes: ["telemetry:write"],
      active: true,
      createdBy: "adm-a"
    });

    const rotateAttempt = async (conn: DbConnection, nextId: string) =>
      withTenantScope(conn.db, alpha, async (tx) => {
        const [existing] = await tx
          .select()
          .from(ingestionTokens)
          .where(and(eq(ingestionTokens.id, tokId), eq(ingestionTokens.tenantId, alpha)))
          .limit(1)
          .for("update");
        if (!existing || !existing.active || existing.revokedAt) return false;
        const deactivated = await tx
          .update(ingestionTokens)
          .set({ active: false, revokedAt: new Date() })
          .where(
            and(
              eq(ingestionTokens.id, tokId),
              eq(ingestionTokens.tenantId, alpha),
              eq(ingestionTokens.active, true),
              isNull(ingestionTokens.revokedAt)
            )
          )
          .returning();
        if (deactivated.length === 0) return false;
        await tx.insert(ingestionTokens).values({
          id: nextId,
          tenantId: alpha,
          plantId: alpha,
          name: "Race GW",
          tokenPrefix: `kjt_${nextId.slice(0, 8)}`,
          tokenHash: `${prefix}-${nextId}`,
          scopes: ["telemetry:write"],
          active: true,
          rotatedFromId: tokId,
          createdBy: "adm-a"
        });
        return true;
      });

    const res = await Promise.all([
      rotateAttempt(first, `succ-1-${crypto.randomUUID().slice(0, 6)}`),
      rotateAttempt(second, `succ-2-${crypto.randomUUID().slice(0, 6)}`)
    ]);
    expect(res.sort()).toEqual([false, true]);
    const successors = await first.db
      .select()
      .from(ingestionTokens)
      .where(eq(ingestionTokens.rotatedFromId, tokId));
    expect(successors).toHaveLength(1);
  });

  it("reads consistent committed role and plant assignments across separate pools during credential refresh", async () => {
    const plant2 = `${alpha}-p2`;
    const uid = `usr-pg-perm-${crypto.randomUUID().slice(0, 8)}`;
    await first.db.execute(
      sql`INSERT INTO plants (id, tenant_id, name, code) VALUES (${plant2}, ${alpha}, 'Alpha P2', 'A2')`
    );
    await first.db.insert(users).values({
      id: uid,
      tenantId: alpha,
      email: `${uid}@alpha.test`,
      name: "PG Perm User",
      passwordHash: "scrypt$00$00",
      role: "engineer",
      active: true,
      tokenVersion: 1
    });
    await first.db.insert(userPlants).values({ tenantId: alpha, userId: uid, plantId: alpha });

    const adminPermUpdate = withTenantScope(first.db, alpha, async (tx) => {
      const [target] = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, uid), eq(users.tenantId, alpha)))
        .limit(1)
        .for("update");
      await tx
        .update(users)
        .set({ role: "analyst", tokenVersion: sql`${users.tokenVersion} + 1` })
        .where(and(eq(users.id, uid), eq(users.tenantId, alpha), eq(users.tokenVersion, target!.tokenVersion)));
      await tx
        .insert(userPlants)
        .values({ tenantId: alpha, userId: uid, plantId: plant2 })
        .onConflictDoNothing();
      return { role: "analyst" };
    });

    const userRefresh = withTenantScope(second.db, alpha, async (tx) => {
      const [locked] = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, uid), eq(users.tenantId, alpha)))
        .limit(1)
        .for("update");
      const [updated] = await tx
        .update(users)
        .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
        .where(and(eq(users.id, uid), eq(users.tenantId, alpha), eq(users.tokenVersion, locked!.tokenVersion)))
        .returning();
      const plants = await tx
        .select({ plantId: userPlants.plantId })
        .from(userPlants)
        .where(and(eq(userPlants.userId, uid), eq(userPlants.tenantId, alpha)));
      return {
        role: updated!.role,
        tokenVersion: updated!.tokenVersion,
        plantIds: plants.map((p) => p.plantId).sort()
      };
    });

    const [, refreshClaims] = await Promise.all([adminPermUpdate, userRefresh]);
    const [finalRow] = await first.db.select().from(users).where(eq(users.id, uid));
    expect(finalRow?.role).toBe("analyst");
    expect(finalRow?.tokenVersion).toBe(3);

    // Either refresh ran first (tokenVersion 2, stale vs final 3) or ran after admin update (saw analyst + both plants at v3).
    if (refreshClaims.tokenVersion === 3) {
      expect(refreshClaims.role).toBe("analyst");
      expect(refreshClaims.plantIds).toEqual([alpha, plant2].sort());
    } else {
      expect(refreshClaims.tokenVersion).toBe(2);
      expect(finalRow!.tokenVersion).toBeGreaterThan(refreshClaims.tokenVersion);
    }
  });
});
