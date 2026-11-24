import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDbConnection, seedDatabase, signSessionToken, type DbConnection } from "@kojo/core";
import { POST as login } from "../apps/web/src/app/api/auth/login/route";
import { getSessionCookieOptions, getSessionUser, handleApiError } from "../apps/web/src/lib/auth";
import { POST as logout } from "../apps/web/src/app/api/auth/logout/route";
import { createLLMProvider } from "@kojo/agent";

const state = vi.hoisted(() => ({ conn: undefined as DbConnection | undefined }));
vi.mock("../apps/web/src/lib/db", () => ({
  getWebAdministrativeDb: async () => state.conn!.db,
  withWebTenantDb: async (_tenant: string, fn: (db: unknown) => unknown) => fn(state.conn!.db)
}));

beforeAll(async () => {
  state.conn = await createDbConnection("memory://");
  await seedDatabase(state.conn);
});
afterAll(async () => state.conn?.close());
afterEach(() => vi.unstubAllEnvs());

describe("Production authentication", () => {
  it("revokes the bearer token on logout, while a new login token remains valid", async () => {
    const user = { userId: "user-admin", tenantId: "tenant-acme", role: "admin" as const, plantIds: ["plant-detroit"], email: "admin@acme.demo", name: "Admin" };
    const token = await signSessionToken(user);
    const req = new Request("http://localhost/api/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(await getSessionUser(req)).not.toBeNull();
    expect((await logout(req)).status).toBe(200);
    expect(await getSessionUser(req)).toBeNull();
    const fresh = await signSessionToken(user);
    expect(await getSessionUser(new Request("http://localhost", { headers: { authorization: `Bearer ${fresh}` } }))).not.toBeNull();
  });
  it("caps repeated sign-in attempts using shared database state", async () => {
    let response!: Response;
    for (let attempt = 0; attempt < 11; attempt++) {
      response = await login(new Request("http://localhost/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "unknown@example.com", password: "wrong-password" })
      }));
      if (attempt < 10) expect(response.status).toBe(401);
    }
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
  });
  it("never sets an insecure session cookie in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COOKIE_SECURE", "false");
    expect(getSessionCookieOptions().secure).toBe(true);
  });
  it("does not leak internal error messages to production clients", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = handleApiError(new Error("private database connection failure"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private database");
  });
  it("rejects missing real AI configuration instead of returning mock answers", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LLM_PROVIDER", "mock");
    expect(() => createLLMProvider()).toThrow(/configured|production/i);
  });
});
