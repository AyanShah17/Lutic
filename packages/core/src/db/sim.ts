import { eq } from "drizzle-orm";
import { createDbConnection } from "./client";
import * as schema from "./schema";
import { isDemoMode } from "../runtime";

async function runSimulator() {
  if (!isDemoMode()) throw new Error("The simulator requires demo mode");
  const conn = await createDbConnection();
  const db = conn.db;
  console.log("Lutic Live Simulator started (writing readings every 5s; Ctrl+C to stop)...");

  const tick = async () => {
    const machines = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.type, "machine"));

    const now = new Date();
    const rows: Array<typeof schema.readings.$inferInsert> = [];

    for (const m of machines.slice(0, 12)) {
      const vib = Number((1.4 + Math.random() * 2.2).toFixed(2));
      const temp = Number((43 + Math.random() * 14).toFixed(1));
      const speed = Number((84 + Math.random() * 16).toFixed(0));

      rows.push(
        {
          id: `sim-${m.id}-vib-${now.getTime()}`,
          tenantId: m.tenantId,
          plantId: m.plantId,
          machineId: m.id,
          tag: "vibration",
          ts: now,
          value: m.id === "mach-l3-filler-01" ? 7.6 : vib,
          unit: "mm/s",
          quality: "good"
        },
        {
          id: `sim-${m.id}-tmp-${now.getTime()}`,
          tenantId: m.tenantId,
          plantId: m.plantId,
          machineId: m.id,
          tag: "temperature",
          ts: now,
          value: m.id === "mach-l1-cnc-01" ? 80.5 : temp,
          unit: "C",
          quality: "good"
        }
      );

      await db
        .update(schema.machineStatus)
        .set({
          vibration: m.id === "mach-l3-filler-01" ? 7.6 : vib,
          temperature: m.id === "mach-l1-cnc-01" ? 80.5 : temp,
          currentSpeed: m.id === "mach-l3-filler-01" ? 0 : speed,
          updatedAt: now
        })
        .where(eq(schema.machineStatus.machineId, m.id));
    }

    if (rows.length > 0) {
      await db.insert(schema.readings).values(rows);
    }

    // Occasionally toggle a transient warning alarm on Line 1 Press #2
    if (Math.random() < 0.2) {
      const transientId = "alm-sim-transient-press2";
      const existing = await db
        .select()
        .from(schema.alarms)
        .where(eq(schema.alarms.id, transientId));

      if (existing.length === 0) {
        await db.insert(schema.alarms).values({
          id: transientId,
          tenantId: "tenant-acme",
          plantId: "plant-detroit",
          machineId: "mach-l1-press-02",
          code: "S31",
          severity: "low",
          message: "Transient light curtain dust warning on Line 1 Hydraulic Press #2",
          raisedAt: now,
          clearedAt: null
        });
      } else if (!existing[0]?.clearedAt) {
        await db
          .update(schema.alarms)
          .set({ clearedAt: now, acknowledgedBy: "AutoSim" })
          .where(eq(schema.alarms.id, transientId));
      }
    }

    console.log(`[sim] ${now.toISOString()} wrote ${rows.length} readings`);
  };

  await tick();
  const interval = setInterval(() => {
    tick().catch((err) => console.error("[sim] tick error:", err));
  }, 5000);

  process.on("SIGINT", async () => {
    clearInterval(interval);
    await conn.close();
    process.exit(0);
  });
}

runSimulator().catch((err) => {
  console.error("Simulator error:", err);
  process.exit(1);
});
