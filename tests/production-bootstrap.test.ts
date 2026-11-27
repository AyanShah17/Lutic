import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptCredentials, signSessionToken, verifyPassword } from "../packages/core/src/crypto";
import { bootstrapDatabase } from "../packages/core/src/db/bootstrap";
import { createDbConnection } from "../packages/core/src/db/client";
import { ensureSchema } from "../packages/core/src/db/migrate";
import { activateLicense, getLicenseStatus } from "../packages/core/src/license";
import { seedDatabase } from "../packages/core/src/db/seed";

const admin = {
  userId: "user-real",
  tenantId: "tenant-real",
  role: "admin" as const,
  plantIds: ["plant-real"],
  email: "admin@example.com",
  name: "Administrator"
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("production deployment", () => {
  it("rejects missing session and encryption secrets in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", undefined);
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", undefined);

    expect(() => encryptCredentials({ apiKey: "example-only" })).toThrow("CREDENTIAL_ENCRYPTION_KEY");
    await expect(signSessionToken(admin)).rejects.toThrow("AUTH_SECRET");
  });

  it("cannot populate an empty production database with demo users", async () => {
    const conn = await createDbConnection("memory://");
    try {
      vi.stubEnv("NODE_ENV", "production");
      await expect(seedDatabase(conn)).rejects.toThrow("Demo seeding is disabled in production");
    } finally {
      await conn.close();
    }
  });

  it("requires a verifiable issuer signature to activate in production", async () => {
    const conn = await createDbConnection("memory://");
    try {
      await ensureSchema(conn);
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("LICENSE_SERVER_URL", "https://issuer.example.com");
      const secret = "eab3ee1da5ad3b76476058ca8d4db3aa";
      vi.stubEnv("LICENSE_SIGNING_SECRET", secret);
      const input = { key: "customer-license", instanceId: "factory-1" };
      const license = { valid: true, status: "active", plan: "pro", expiresAt: "2099-01-01T00:00:00.000Z" };
      vi.stubGlobal("fetch", vi.fn(async () => Response.json(license)));

      await expect(activateLicense(conn.db, input)).resolves.toMatchObject({ valid: false });
      await expect(getLicenseStatus(conn.db)).resolves.toMatchObject({ active: false });

      const canonical = [input.key, license.status, license.plan, license.expiresAt, input.instanceId].join("|");
      const signature = createHmac("sha256", secret).update(canonical).digest("hex");
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...license, signature })));
      await expect(activateLicense(conn.db, input)).resolves.toMatchObject({ valid: true });
      await expect(getLicenseStatus(conn.db)).resolves.toMatchObject({ active: true });
    } finally {
      await conn.close();
    }
  });

  it("bootstraps once, preserves credentials, and leaves operational tables empty", async () => {
    const conn = await createDbConnection("memory://");
    const config = {
      LUTIC_TENANT_NAME: "Metro Manufacturing",
      LUTIC_PLANT_NAME: "Main Campus",
      LUTIC_ADMIN_EMAIL: "Owner@metro.example",
      LUTIC_ADMIN_PASSWORD: "75f1481d012137f8d46becd87a10e975"
    };
    try {
      await ensureSchema(conn);
      const attempts = await Promise.all([
        bootstrapDatabase(conn, config),
        bootstrapDatabase(conn, config)
      ]);
      expect(attempts.sort()).toEqual([false, true]);
      await expect(bootstrapDatabase(conn, { ...config, LUTIC_ADMIN_PASSWORD: "9c5670f33c31ec5136a65942750c899f" }))
        .resolves.toBe(false);

      const [tenant] = await conn.db.query.tenants.findMany();
      const [plant] = await conn.db.query.plants.findMany();
      const [user] = await conn.db.query.users.findMany();
      expect(tenant).toMatchObject({ name: config.LUTIC_TENANT_NAME });
      expect(plant).toMatchObject({ tenantId: tenant.id, name: config.LUTIC_PLANT_NAME });
      expect(user).toMatchObject({ tenantId: tenant.id, role: "admin", email: "owner@metro.example" });
      expect(verifyPassword(config.LUTIC_ADMIN_PASSWORD, user.passwordHash)).toBe(true);
      await expect(conn.db.query.userPlants.findMany()).resolves.toEqual([{ tenantId: tenant.id, userId: user.id, plantId: plant.id }]);
      await expect(conn.db.query.toolkits.findMany()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ tenantId: tenant.id, name: "knowledge" }),
        expect.objectContaining({ tenantId: tenant.id, name: "paas" })
      ]));
      await expect(conn.db.query.connectorConnections.findMany()).resolves.toEqual([]);
      await expect(conn.db.query.topics.findMany()).resolves.toEqual([
        expect.objectContaining({ tenantId: tenant.id, name: "plant-alerts" })
      ]);
      await expect(conn.db.query.queues.findMany()).resolves.toEqual([
        expect.objectContaining({ tenantId: tenant.id, name: "ops-dispatch" })
      ]);
      await expect(conn.db.query.assets.findMany()).resolves.toEqual([]);
      await expect(conn.db.query.connectors.findMany()).resolves.toEqual([]);
    } finally {
      await conn.close();
    }
  });

  it("creates mode-0600 deployment configuration, preserves it, and supports bootstrap --dry-run", () => {
    const dir = mkdtempSync(join(tmpdir(), "lutic-prod-env-"));
    try {
      const envFile = join(dir, "production.env");
      const cli = resolve(__dirname, "../deploy/lutic.sh");
      const command = [cli, "prepare", "--env-file", envFile];
      execFileSync("bash", command);
      const original = readFileSync(envFile, "utf8");
      expect(statSync(envFile).mode & 0o777).toBe(0o600);
      expect(original).toMatch(/^AUTH_SECRET=[a-f0-9]{64}$/m);
      expect(original).toMatch(/^CREDENTIAL_ENCRYPTION_KEY=[a-f0-9]{64}$/m);
      const databasePassword = original.match(/^POSTGRES_PASSWORD=([a-f0-9]{64})$/m)?.[1];
      expect(databasePassword).toBeDefined();
      expect(original).toContain(`DATABASE_URL=postgresql://lutic:${databasePassword}@postgres:5432/lutic`);
      const gatewayKey = original.match(/^LITELLM_MASTER_KEY=(sk-lutic-[a-f0-9]{64})$/m)?.[1];
      expect(gatewayKey).toBeDefined();
      expect(original).toContain(`LUTIC_AI_GATEWAY_KEY=${gatewayKey}`);

      execFileSync("bash", command);
      expect(readFileSync(envFile, "utf8")).toBe(original);

      const deployScript = resolve(__dirname, "../deploy/lutic-linux-deploy.sh");
      execFileSync("bash", ["-n", deployScript]);
      const dryRun = execFileSync("bash", [cli, "bootstrap", "--dry-run", "--env-file", envFile], {
        encoding: "utf8"
      });
      expect(dryRun).toContain("[dry-run] bootstrap");
      expect(dryRun).toContain("packages/core/src/db/bootstrap.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
