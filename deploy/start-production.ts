import { createDbConnection } from "../packages/core/src/db/client";
import { ensureSchema } from "../packages/core/src/db/migrate";
import { tenants } from "../packages/core/src/db/schema";
import { validateProductionConfig } from "../packages/core/src/production-config";

try {
  validateProductionConfig();
  const conn = await createDbConnection();
  try {
    await ensureSchema(conn);
    const [tenant] = await conn.db.select({ id: tenants.id }).from(tenants).limit(1);
    if (!tenant) throw new Error("Run the production bootstrap command before starting Kojo");
    const demoTenant = await conn.db.query.tenants.findFirst({
      columns: { id: true },
      where: (tenant, { inArray }) => inArray(tenant.id, ["tenant-acme", "tenant-beta"])
    });
    if (demoTenant) throw new Error("Select a production database without demo tenants");
  } finally {
    await conn.close();
  }
} catch (error) {
  console.error(`Kojo startup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
