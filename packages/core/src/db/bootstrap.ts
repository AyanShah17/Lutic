import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { hashPassword } from "../crypto";
import { requireDeploymentSecret, requireProductionDatabaseUrl } from "../production-config";
import { createDbConnection, type DbConnection } from "./client";
import { installCoreToolkits } from "./core-toolkits";
import { ensureSchema } from "./migrate";
import { plants, queues, tenants, topics, userPlants, users } from "./schema";

const bootstrapSchema = z.object({
  LUTIC_TENANT_NAME: z.string().trim().min(1).max(200),
  LUTIC_PLANT_NAME: z.string().trim().min(1).max(200),
  LUTIC_ADMIN_EMAIL: z.string().trim().email().toLowerCase(),
  LUTIC_ADMIN_PASSWORD: z.string().max(1024)
});

export async function bootstrapDatabase(conn: DbConnection, env: NodeJS.ProcessEnv): Promise<boolean> {
  const config = bootstrapSchema.parse({
    LUTIC_TENANT_NAME: env.LUTIC_TENANT_NAME || env.LUTIC_BOOTSTRAP_TENANT_NAME,
    LUTIC_PLANT_NAME: env.LUTIC_PLANT_NAME || env.LUTIC_BOOTSTRAP_PLANT_NAME,
    LUTIC_ADMIN_EMAIL: env.LUTIC_ADMIN_EMAIL || env.LUTIC_BOOTSTRAP_EMAIL,
    LUTIC_ADMIN_PASSWORD: env.LUTIC_ADMIN_PASSWORD || env.LUTIC_BOOTSTRAP_PASSWORD
  });
  const password = requireDeploymentSecret("LUTIC_ADMIN_PASSWORD", config.LUTIC_ADMIN_PASSWORD, 16);
  return conn.db.transaction(async (tx) => {
    // Serialize concurrent attempts and keep existing installations untouched.
    await tx.execute(sql`LOCK TABLE tenants IN EXCLUSIVE MODE`);
    if ((await tx.select({ id: tenants.id }).from(tenants).limit(1)).length > 0) return false;

    const tenantId = randomUUID();
    const plantId = randomUUID();
    const userId = randomUUID();
    const slug = config.LUTIC_TENANT_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    await tx.insert(tenants).values({ id: tenantId, slug: slug || tenantId, name: config.LUTIC_TENANT_NAME });
    await tx.insert(plants).values({ id: plantId, tenantId, name: config.LUTIC_PLANT_NAME, code: "PLANT-01", timezone: "UTC" });
    await tx.insert(users).values({
      id: userId,
      tenantId,
      name: "Administrator",
      email: config.LUTIC_ADMIN_EMAIL,
      passwordHash: hashPassword(password),
      role: "admin"
    });
    await tx.insert(userPlants).values({ tenantId, userId, plantId });
    await installCoreToolkits(tx, tenantId, `${tenantId}-`);

    await tx.insert(topics).values({
      id: `topic-${tenantId}-plant-alerts`,
      tenantId,
      name: "plant-alerts",
      description: "Default plant alerts and operational events topic"
    });
    await tx.insert(queues).values({
      id: `queue-${tenantId}-ops-dispatch`,
      tenantId,
      name: "ops-dispatch",
      description: "Default operational dispatch queue"
    });
    return true;
  });
}

if (/[\\/]bootstrap\.ts$/.test(process.argv[1] ?? "")) {
  try {
    const conn = await createDbConnection(requireProductionDatabaseUrl(process.env.DATABASE_URL));
    try {
      await ensureSchema(conn);
      const created = await bootstrapDatabase(conn, process.env);
      console.log(created ? "Initial tenant, plant, and administrator created." : "An existing tenant is already provisioned.");
    } finally {
      await conn.close();
    }
  } catch (error) {
    console.error(`Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
