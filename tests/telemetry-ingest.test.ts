import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  and,
  assets,
  createDbConnection,
  eq,
  machineStatus,
  readings,
  seedDatabase,
  signSessionToken,
  userPlants,
  withTenantScope,
  type DbConnection,
  type KojoDatabase
} from "@kojo/core";
import { POST } from "../apps/web/src/app/api/telemetry/route";

const state = vi.hoisted(() => ({ conn: undefined as DbConnection | undefined }));
vi.mock("../apps/web/src/lib/db", () => ({
  getWebAdministrativeDb: async () => state.conn!.db,
  requireWebLicense: async () => {},
  withWebTenantDb: (tenantId: string, run: (db: KojoDatabase) => Promise<unknown>) =>
    withTenantScope(state.conn!.db, tenantId, run)
}));

const tenantId = "tenant-acme";
const machineId = "machine-telemetry-test";
const plantId = "plant-detroit";
let token: string;

beforeAll(async () => {
  const conn = await createDbConnection("memory://");
  state.conn = conn;
  await seedDatabase(conn);
  await conn.db.insert(assets).values({ id: machineId, tenantId, plantId, type: "machine", name: "Press telemetry test" });
  await conn.db.delete(userPlants).where(and(eq(userPlants.userId, "user-admin"), eq(userPlants.plantId, "plant-austin")));
  token = await signSessionToken({
    userId: "user-admin", tenantId, role: "admin", plantIds: [plantId], email: "admin@acme.demo", name: "Admin"
  });
});

afterAll(async () => state.conn?.close());

function sample(sampleId: string, ageMs = 1000) {
  return {
    sampleId,
    machineId,
    recordedAt: new Date(Date.now() - ageMs).toISOString(),
    status: "running",
    temperature: 43.2,
    vibration: 1.7,
    pressure: 6.2,
    currentSpeed: 91
  };
}

function submit(samples: Array<ReturnType<typeof sample>>, bearer: string | null = token) {
  const headers = new Headers({ "content-type": "application/json" });
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  return POST(new Request("http://localhost/api/telemetry", {
    method: "POST", headers, body: JSON.stringify({ samples })
  }));
}

it("requires authentication and rejects the entire batch when any machine is outside the administrator's plant", async () => {
  expect((await submit([sample("unauthenticated")], null)).status).toBe(401);
  const response = await submit([
    sample("allowed-machine"),
    { ...sample("forbidden-machine"), machineId: "mach-aus-press-02" }
  ]);
  expect(response.status).toBe(403);
  const stored = await state.conn!.db.select().from(readings).where(eq(readings.machineId, machineId));
  expect(stored).toHaveLength(0);
});

it("stores each snapshot once and leaves latest machine status at the newest timestamp", async () => {
  const fresh = sample("latest");
  const older = { ...sample("history", 60_000), temperature: 17, status: "idle" };
  const first = await submit([fresh, fresh]);
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ acceptedSamples: 1, duplicateSamples: 1, updatedMachines: 1 });

  const retry = await submit([fresh, older]);
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ acceptedSamples: 1, duplicateSamples: 1, updatedMachines: 0 });

  const db = state.conn!.db;
  const [status] = await db.select().from(machineStatus).where(eq(machineStatus.machineId, machineId));
  expect(status).toMatchObject({ status: "running", temperature: 43.2, updatedAt: new Date(fresh.recordedAt) });
  const stored = await db.select().from(readings).where(eq(readings.machineId, machineId));
  expect(stored).toHaveLength(8);
  expect(stored).toEqual(expect.arrayContaining([
    expect.objectContaining({ tag: "temperature", value: 17, unit: "C", ts: new Date(older.recordedAt) }),
    expect.objectContaining({ tag: "speed", value: 91, unit: "%", ts: new Date(fresh.recordedAt) })
  ]));
});

it("rejects future samples and requests over the batch limit", async () => {
  expect((await submit([sample("future", -60_000)])).status).toBe(400);
  expect((await submit(Array.from({ length: 101 }, (_, index) => sample(String(index))))).status).toBe(400);
});
