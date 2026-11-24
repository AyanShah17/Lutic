import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  and,
  assets,
  createDbConnection,
  ensureSchema,
  eq,
  getDbConnection,
  machineStatus,
  seedDatabase,
  signSessionToken,
  sql,
  stopBackgroundRuntime,
  withTenantScope,
  type DbConnection,
  type SessionUser
} from "@lutic/core";
import { GET as getMachine } from "../apps/web/src/app/api/machines/[id]/route";

describe("tenant database isolation", () => {
  let conn: DbConnection;
  const rlsViolation = {
    cause: { code: "42501", message: expect.stringMatching(/row-level security/i) }
  };

  beforeAll(async () => {
    conn = await createDbConnection("memory://");
    await ensureSchema(conn);
    await conn.executeRaw(`
      INSERT INTO tenants (id, name, slug) VALUES ('alpha', 'Alpha', 'alpha'), ('beta', 'Beta', 'beta');
      INSERT INTO plants (id, tenant_id, name, code) VALUES ('alpha-plant', 'alpha', 'Alpha Plant', 'A'), ('beta-plant', 'beta', 'Beta Plant', 'B');
      INSERT INTO failure_modes (id, tenant_id, iso_code, mode, mechanism, cause)
      VALUES ('alpha-mode', 'alpha', 'A', 'Alpha', '', ''), ('beta-mode', 'beta', 'B', 'Beta', '', '');
    `);
  });

  afterAll(async () => {
    await conn?.close();
  });

  it("requires nonempty tenant context for the application database role", async () => {
    async function readWithoutScope() {
      return conn.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE lutic_app`);
        return (await tx.execute(sql`SELECT id FROM plants ORDER BY id`)).rows;
      });
    }

    expect(await readWithoutScope()).toEqual([]);
    await withTenantScope(conn.db, "alpha", (tx) => tx.execute(sql`SELECT id FROM plants`));
    expect(await readWithoutScope()).toEqual([]);

    await expect(conn.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE lutic_app`);
      await tx.execute(sql`INSERT INTO plants (id, tenant_id, name, code) VALUES ('no-context', 'alpha', 'Denied', 'X')`);
    })).rejects.toMatchObject(rlsViolation);
  });

  it("scopes all tenant tables and rejects writes with another tenant ID", async () => {
    const modes = await withTenantScope(conn.db, "alpha", (tx) =>
      tx.execute(sql`SELECT id FROM failure_modes ORDER BY id`)
    );
    expect(modes.rows).toEqual([{ id: "alpha-mode" }]);

    const foreignUpdate = await withTenantScope(conn.db, "alpha", (tx) =>
      tx.execute(sql`UPDATE plants SET name = 'Changed' WHERE id = 'beta-plant' RETURNING id`)
    );
    expect(foreignUpdate.rows).toEqual([]);

    await expect(withTenantScope(conn.db, "alpha", async (tx) => {
      await tx.execute(sql`INSERT INTO failure_modes (id, tenant_id, iso_code, mode, mechanism, cause) VALUES ('foreign-insert', 'beta', 'B', 'Denied', '', '')`);
    })).rejects.toMatchObject(rlsViolation);

    await expect(withTenantScope(conn.db, "alpha", async (tx) => {
      await tx.execute(sql`UPDATE plants SET tenant_id = 'beta' WHERE id = 'alpha-plant'`);
    })).rejects.toMatchObject(rlsViolation);

    const changes = await conn.db.execute(sql`SELECT id, tenant_id FROM plants ORDER BY id`);
    expect(changes.rows).toEqual([
      { id: "alpha-plant", tenant_id: "alpha" },
      { id: "beta-plant", tenant_id: "beta" }
    ]);
  });

  it("keeps simultaneous tenant transactions isolated", async () => {
    const results = await Promise.all(["alpha", "beta"].map((tenantId) =>
      withTenantScope(conn.db, tenantId, async (tx) => {
        const before = await tx.execute(sql`SELECT tenant_id FROM plants`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const after = await tx.execute(sql`SELECT tenant_id FROM plants`);
        return [...before.rows, ...after.rows];
      })
    ));
    expect(results).toEqual([
      [{ tenant_id: "alpha" }, { tenant_id: "alpha" }],
      [{ tenant_id: "beta" }, { tenant_id: "beta" }]
    ]);
  });
});

describe("machine detail API tenant isolation", () => {
  let conn: DbConnection;
  const acme: SessionUser = {
    userId: "user-det-eng",
    tenantId: "tenant-acme",
    role: "engineer",
    plantIds: ["plant-detroit"],
    email: "engineer@acme.demo",
    name: "Marcus Vance"
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = "memory://";
    conn = await getDbConnection();
    await seedDatabase(conn);
  });

  afterAll(async () => {
    stopBackgroundRuntime();
    await conn?.close();
    delete process.env.DATABASE_URL;
  });

  it("returns an authorized machine without exposing another tenant's related status", async () => {
    const acmeMachine = "tenant-isolation-fixture";
    await conn.db.insert(assets).values({
      id: acmeMachine,
      tenantId: acme.tenantId,
      plantId: "plant-detroit",
      type: "machine",
      name: "Tenant isolation fixture"
    });
    await conn.db.insert(machineStatus).values({
      id: "tenant-isolation-fixture-status",
      tenantId: "tenant-beta",
      plantId: "plant-detroit",
      machineId: acmeMachine,
      status: "fault"
    });

    const token = await signSessionToken(acme);
    async function readMachine(id: string) {
      const req = new Request(`http://localhost/api/machines/${id}`, {
        headers: { authorization: `Bearer ${token}` }
      });
      return getMachine(req, { params: Promise.resolve({ id }) });
    }

    try {
      const [visible, hidden] = await Promise.all([
        readMachine(acmeMachine),
        readMachine("mach-beta-cnc-01")
      ]);
      expect(visible.status).toBe(200);
      expect(await visible.json()).toMatchObject({ machine: { id: acmeMachine }, status: null });
      expect(hidden.status).toBe(404);
    } finally {
      await conn.db.delete(machineStatus).where(and(
        eq(machineStatus.tenantId, "tenant-beta"),
        eq(machineStatus.machineId, acmeMachine)
      ));
      await conn.db.delete(assets).where(eq(assets.id, acmeMachine));
    }
  });
});
