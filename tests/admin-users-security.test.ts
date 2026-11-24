import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDbConnection, seedDatabase, withTenantScope, type DbConnection } from "@kojo/core";
import { POST, PATCH } from "../apps/web/src/app/api/admin/users/route";

const state = vi.hoisted(() => ({ conn: undefined as DbConnection | undefined }));
vi.mock("../apps/web/src/lib/db", () => ({
  requireWebLicense: async () => {},
  withWebTenantDb: async (tenant: string, fn: Parameters<typeof withTenantScope>[2]) => withTenantScope(state.conn!.db, tenant, fn)
}));
vi.mock("../apps/web/src/lib/auth", async (original) => ({
  ...await original<typeof import("../apps/web/src/lib/auth")>(),
  getSessionUser: async () => ({
    userId: "user-admin", tenantId: "tenant-acme", role: "admin", plantIds: ["plant-detroit", "plant-austin"],
    email: "admin@acme.demo", name: "Admin"
  })
}));

beforeAll(async () => {
  state.conn = await createDbConnection("memory://");
  await seedDatabase(state.conn);
});
afterAll(async () => state.conn?.close());
const request = (body: unknown, method = "POST") => new Request("http://localhost/api/admin/users", {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body)
});
const user = { email: "new@example.com", name: "New User", role: "engineer", plantIds: ["plant-detroit"] };

describe("Administrator user provisioning", () => {
  it("requires an explicit password instead of assigning a shared demo password", async () => {
    expect((await POST(request(user))).status).toBe(400);
  });
  it("rejects another tenant's plant assignment", async () => {
    expect((await POST(request({ ...user, email: "foreign@example.com", password: "Unique-passphrase-4078", plantIds: ["plant-beta-01"] }))).status).toBe(403);
  });
  it("returns 404 for a target user outside the tenant", async () => {
    expect((await PATCH(request({ userId: "not-in-this-tenant", active: false }, "PATCH"))).status).toBe(404);
  });
  it("prevents removing the last active administrator", async () => {
    expect((await PATCH(request({ userId: "user-admin", role: "engineer" }, "PATCH"))).status).toBe(409);
  });
});
