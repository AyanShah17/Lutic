import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, getDbConnection, ensureSchema, assets, machineStatus, plants } from "@kojo/core";
import { bootstrapDatabase } from "../packages/core/src/db/bootstrap";
import * as assetsRoute from "../apps/web/src/app/api/admin/assets/route";
import { POST as loginPost } from "../apps/web/src/app/api/auth/login/route";

const email = "admin@new-plant.example";
const password = "142ad40a7dd5d65437eb805ebc426459";
let token: string;
let tenantId: string;
let plantId: string;

function createAsset(body: Record<string, unknown>) {
  return assetsRoute.POST(new Request("https://kojo.example/api/admin/assets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }));
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "memory://");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_SECRET", "84f025c02a72de52f50c4ed583fb6efc9");
  vi.stubEnv("LICENSE_ENFORCE", "false");
  vi.stubEnv("KOJO_RUNTIME_DISABLED", "true");
  const conn = await getDbConnection();
  await ensureSchema(conn);
  await bootstrapDatabase(conn, {
    KOJO_TENANT_NAME: "New Tenant",
    KOJO_PLANT_NAME: "First Plant",
    KOJO_ADMIN_EMAIL: email,
    KOJO_ADMIN_PASSWORD: password
  });
  const response = await loginPost(new Request("https://kojo.example/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  }));
  expect(response.status).toBe(200);
  const session = await response.json();
  token = session.token;
  tenantId = session.user.tenantId;
  [plantId] = session.user.plantIds;
});

afterAll(async () => {
  const conn = await getDbConnection();
  await conn.close();
  vi.unstubAllEnvs();
});

describe("admin asset creation", () => {
  it("creates a line and machine for a fresh tenant without inventing telemetry", async () => {
    const lineResponse = await createAsset({ type: "line", name: "Finishing", plantId });
    expect(lineResponse.status).toBe(201);
    const { asset: line } = await lineResponse.json();
    const machineResponse = await createAsset({ type: "machine", name: "Conveyor", plantId, parentId: line.id });
    expect(machineResponse.status).toBe(201);
    const { asset: machine } = await machineResponse.json();
    expect(machine).toMatchObject({ name: "Conveyor", type: "machine", tenantId, plantId, parentId: line.id });
    const read = await assetsRoute.GET(new Request("https://kojo.example/api/admin/assets", {
      headers: { Authorization: `Bearer ${token}` }
    }));
    await expect(read.json()).resolves.toMatchObject({
      plants: [expect.objectContaining({ id: plantId })],
      assets: expect.arrayContaining([
        expect.objectContaining({ id: line.id, liveStatus: null }),
        expect.objectContaining({ id: machine.id, liveStatus: null })
      ])
    });
    const { db } = await getDbConnection();
    await expect(db.select().from(machineStatus).where(eq(machineStatus.machineId, machine.id))).resolves.toEqual([]);
  });

  it("rejects plants outside the admin's scope and a line from another plant", async () => {
    const { db } = await getDbConnection();
    await db.insert(plants).values({ id: "second-plant", tenantId, name: "Second Plant", code: "S2" });
    await db.insert(assets).values({ id: "other-line", tenantId, plantId: "second-plant", name: "Other line", type: "line" });
    expect((await createAsset({ type: "line", name: "Outside", plantId: "second-plant" })).status).toBe(403);
    expect((await createAsset({ type: "machine", name: "Outside", plantId, parentId: "other-line" })).status).toBe(400);
  });
});
