import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDbConnection, seedDatabase, withTenantScope, type DbConnection } from "@kojo/core";
import { GET as getAdminConnectors } from "../apps/web/src/app/api/admin/connectors/route";
import { POST as postTopicSubscribe } from "../apps/web/src/app/api/topics/[id]/subscribe/route";
import { POST as postSubscriptions } from "../apps/web/src/app/api/subscriptions/route";

const state = vi.hoisted(() => ({ conn: undefined as DbConnection | undefined }));
vi.mock("../apps/web/src/lib/db", () => ({
  requireWebLicense: async () => {},
  withWebTenantDb: async (tenant: string, fn: Parameters<typeof withTenantScope>[2]) =>
    withTenantScope(state.conn!.db, tenant, fn)
}));
vi.mock("../apps/web/src/lib/auth", async (original) => ({
  ...(await original<typeof import("../apps/web/src/lib/auth")>()),
  getSessionUser: async () => ({
    userId: "user-admin",
    tenantId: "tenant-acme",
    role: "admin",
    plantIds: ["plant-detroit", "plant-austin"],
    email: "admin@acme.demo",
    name: "Admin"
  })
}));

beforeAll(async () => {
  state.conn = await createDbConnection("memory://");
  await seedDatabase(state.conn);
});

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => state.conn?.close());

describe("M1 route guards & Zod v4 connector schema extraction", () => {
  it("extracts Zod v4 schema fields and defaults in demo mode and omits them in non-demo mode", async () => {
    vi.stubEnv("KOJO_DEMO_MODE", "true");
    const demoRes = await getAdminConnectors(new Request("http://localhost/api/admin/connectors"));
    expect(demoRes.status).toBe(200);
    const demoBody = (await demoRes.json()) as {
      schemas: Array<{
        kind: string;
        fields: Array<{ key: string; type: string; defaultValue: unknown }>;
      }>;
    };
    expect(demoBody.schemas.length).toBe(5);

    const docs = demoBody.schemas.find((s) => s.kind === "docs");
    expect(docs?.fields.find((f) => f.key === "readOnly")).toEqual({
      key: "readOnly",
      type: "boolean",
      defaultValue: true
    });

    const historian = demoBody.schemas.find((s) => s.kind === "historian");
    expect(historian?.fields.find((f) => f.key === "pollIntervalSec")).toEqual({
      key: "pollIntervalSec",
      type: "number",
      defaultValue: 5
    });

    const cmms = demoBody.schemas.find((s) => s.kind === "cmms");
    expect(cmms?.fields.find((f) => f.key === "apiKey")).toEqual({
      key: "apiKey",
      type: "password",
      defaultValue: "cmms-demo-key"
    });

    vi.stubEnv("KOJO_DEMO_MODE", "false");
    const prodRes = await getAdminConnectors(new Request("http://localhost/api/admin/connectors"));
    expect(prodRes.status).toBe(200);
    const prodBody = (await prodRes.json()) as {
      schemas: Array<{ kind: string; fields: unknown[] }>;
    };
    expect(prodBody.schemas.every((s) => s.fields.length === 0)).toBe(true);
  });

  it("blocks webhook subscriptions with HTTP 501 outside demo mode while allowing in_app and demo webhooks", async () => {
    vi.stubEnv("KOJO_DEMO_MODE", "false");

    const subWebhookByProtocol = await postTopicSubscribe(
      new Request("http://localhost/api/topics/topic-plant-alerts/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ protocol: "webhook", endpoint: "https://hooks.example.test/kojo" })
      }),
      { params: Promise.resolve({ id: "topic-plant-alerts" }) }
    );
    expect(subWebhookByProtocol.status).toBe(501);

    const subWebhookByTargetType = await postTopicSubscribe(
      new Request("http://localhost/api/topics/topic-plant-alerts/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType: "webhook", endpoint: "https://hooks.example.test/kojo" })
      }),
      { params: Promise.resolve({ id: "topic-plant-alerts" }) }
    );
    expect(subWebhookByTargetType.status).toBe(501);

    const directWebhook = await postSubscriptions(
      new Request("http://localhost/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topicId: "topic-plant-alerts",
          protocol: "webhook",
          endpoint: "https://hooks.example.test/kojo"
        })
      })
    );
    expect(directWebhook.status).toBe(501);

    const inAppSub = await postTopicSubscribe(
      new Request("http://localhost/api/topics/topic-plant-alerts/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ protocol: "in_app", endpoint: "all" })
      }),
      { params: Promise.resolve({ id: "topic-plant-alerts" }) }
    );
    expect(inAppSub.status).toBe(201);

    vi.stubEnv("KOJO_DEMO_MODE", "true");
    const demoSub = await postTopicSubscribe(
      new Request("http://localhost/api/topics/topic-plant-alerts/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ protocol: "webhook", endpoint: "https://hooks.example.test/kojo" })
      }),
      { params: Promise.resolve({ id: "topic-plant-alerts" }) }
    );
    expect(demoSub.status).toBe(201);

    const demoDirect = await postSubscriptions(
      new Request("http://localhost/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topicId: "topic-plant-alerts",
          protocol: "webhook",
          endpoint: "https://hooks.example.test/kojo"
        })
      })
    );
    expect(demoDirect.status).toBe(201);
  });
});
