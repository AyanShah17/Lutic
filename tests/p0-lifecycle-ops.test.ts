import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  and,
  assets,
  auditLog,
  connectorConnections,
  connectors,
  conversations,
  createDbConnection,
  decryptCredentials,
  encryptCredentials,
  ensureSchema,
  eq,
  getAppliedMigrations,
  ingestionTokens,
  machineStatus,
  messages,
  MIGRATIONS,
  notifications,
  readings,
  rotateStoredCredentials,
  schemaMigrations,
  seedDatabase,
  sha256Hex,
  signSessionToken,
  sql,
  usageLog,
  userPlants,
  users,
  verifySessionToken,
  withTenantScope,
  workflowRuns,
  workflows,
  type DbConnection,
  type LuticDatabase
} from "@lutic/core";
import { validateProductionConfig } from "../packages/core/src/production-config";
import { LLMTimeoutError, MockLLMProvider, runAgentTurn } from "@lutic/agent";

const state = vi.hoisted(() => ({
  conn: undefined as DbConnection | undefined
}));

vi.mock("../apps/web/src/lib/db", () => ({
  getWebAdministrativeDb: async () => state.conn!.db,
  getWebDbConnection: async () => state.conn!,
  requireWebLicense: async () => {},
  withWebTenantDb: (tenantId: string, run: (db: LuticDatabase) => Promise<unknown>) =>
    withTenantScope(state.conn!.db, tenantId, run)
}));

import { POST as changePasswordPost } from "../apps/web/src/app/api/auth/change-password/route";
import { POST as demoSwitchPost } from "../apps/web/src/app/api/auth/demo-switch/route";
import {
  GET as adminUsersGet,
  PATCH as adminUsersPatch,
  POST as adminUsersPost
} from "../apps/web/src/app/api/admin/users/route";
import { handleApiError } from "../apps/web/src/lib/auth";
import { GET as diagnosticsGet } from "../apps/web/src/app/api/admin/diagnostics/route";
import { POST as retentionPost } from "../apps/web/src/app/api/admin/retention/route";
import {
  GET as ingestionTokensGet,
  PATCH as ingestionTokensPatch,
  POST as ingestionTokensPost
} from "../apps/web/src/app/api/admin/ingestion-tokens/route";
import { POST as telemetryPost } from "../apps/web/src/app/api/telemetry/route";
import { GET as liveHealthGet } from "../apps/web/src/app/api/health/live/route";
import { GET as conversationsGet } from "../apps/web/src/app/api/conversations/route";
import { GET as sharedConvGet } from "../apps/web/src/app/api/conversations/share/[token]/route";
import { POST as chatPost } from "../apps/web/src/app/api/chat/route";

describe("Phase 1 P0 & P1-01 Lifecycle, Security, Rotation, Diagnostics & Ingestion Tokens", () => {
  let conn: DbConnection;

  beforeAll(async () => {
    conn = await createDbConnection("memory://");
    state.conn = conn;
    await seedDatabase(conn);
  });

  afterAll(async () => {
    await conn?.close();
  });

  it("tracks versioned schema_migrations, enforces checksums, and serializes concurrent ensureSchema", async () => {
    const applied = await getAppliedMigrations(conn);
    expect(applied.map((m) => ({ version: m.version, name: m.name }))).toEqual(
      MIGRATIONS.map((m) => ({ version: m.version, name: m.name }))
    );

    await Promise.all([ensureSchema(conn), ensureSchema(conn)]);
    const afterConcurrent = await getAppliedMigrations(conn);
    expect(afterConcurrent).toHaveLength(MIGRATIONS.length);

    // Tamper simulation on isolated memory DB: checksum mismatch must abort startup cleanly
    const isolated = await createDbConnection("memory://");
    try {
      await ensureSchema(isolated);
      await isolated.db
        .update(schemaMigrations)
        .set({ checksum: "tampered-checksum" })
        .where(eq(schemaMigrations.version, 2));
      await expect(ensureSchema(isolated)).rejects.toThrow(/checksum mismatch/i);
    } finally {
      await isolated.close();
    }
  });

  it("supports zero-downtime AUTH_SECRET and CREDENTIAL_ENCRYPTION_KEY rotation", async () => {
    const prevAuth = process.env.AUTH_SECRET;
    const prevAuthOld = process.env.AUTH_SECRET_PREVIOUS;
    const prevEnc = process.env.CREDENTIAL_ENCRYPTION_KEY;
    const prevEncOld = process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS;

    const oldAuthSecret = "old-auth-secret-material-for-rotation-check-1234";
    const newAuthSecret = "new-auth-secret-material-for-rotation-check-5678";
    const oldEncKey = "11".repeat(32);
    const newEncKey = "22".repeat(32);

    try {
      process.env.AUTH_SECRET = oldAuthSecret;
      delete process.env.AUTH_SECRET_PREVIOUS;
      const oldJwt = await signSessionToken(
        {
          userId: "user-admin",
          tenantId: "tenant-acme",
          role: "admin",
          plantIds: ["plant-detroit", "plant-austin"],
          email: "admin@acme.demo",
          name: "Admin"
        },
        { tokenVersion: 1 }
      );

      process.env.CREDENTIAL_ENCRYPTION_KEY = oldEncKey;
      delete process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS;
      const legacySecret = encryptCredentials({ apiKey: "scada-secret-v1" });
      await conn.db.insert(connectors).values({
        id: "conn-rot-beta",
        tenantId: "tenant-beta",
        kind: "cmms",
        name: "Rotation Test Connector",
        encryptedCredentials: legacySecret
      });
      await conn.db.insert(connectorConnections).values({
        id: "connhub-rot-1",
        tenantId: "tenant-acme",
        slug: "rot-test",
        name: "Rotation Hub Connector",
        encryptedCredentials: legacySecret
      });

      // Rotate secrets keeping old key in *_PREVIOUS
      process.env.AUTH_SECRET = newAuthSecret;
      process.env.AUTH_SECRET_PREVIOUS = oldAuthSecret;
      const verifiedWithPrev = await verifySessionToken(oldJwt);
      expect(verifiedWithPrev?.userId).toBe("user-admin");

      process.env.CREDENTIAL_ENCRYPTION_KEY = newEncKey;
      process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS = `${oldEncKey},${prevEnc || "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}`;
      expect(decryptCredentials(legacySecret)).toEqual({ apiKey: "scada-secret-v1" });

      const rotationSummary = await rotateStoredCredentials(conn.db);
      expect(rotationSummary.connectorsRotated).toBeGreaterThanOrEqual(1);
      expect(rotationSummary.connectionsRotated).toBeGreaterThanOrEqual(1);

      // Remove old keys and verify re-encrypted credentials decrypt with only new key while old JWT fails
      delete process.env.AUTH_SECRET_PREVIOUS;
      delete process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS;
      expect(await verifySessionToken(oldJwt)).toBeNull();

      const [updatedConn] = await conn.db
        .select()
        .from(connectorConnections)
        .where(eq(connectorConnections.id, "connhub-rot-1"));
      expect(decryptCredentials(updatedConn!.encryptedCredentials)).toEqual({
        apiKey: "scada-secret-v1"
      });
    } finally {
      if (prevAuth === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevAuth;
      if (prevAuthOld === undefined) delete process.env.AUTH_SECRET_PREVIOUS;
      else process.env.AUTH_SECRET_PREVIOUS = prevAuthOld;
      if (prevEnc === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      else process.env.CREDENTIAL_ENCRYPTION_KEY = prevEnc;
      if (prevEncOld === undefined) delete process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS;
      else process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS = prevEncOld;
    }
  });

  it("handles authenticated password change, admin password reset + session revocation, and never logs reset passwords", async () => {
    const engineerTokenV1 = await signSessionToken(
      {
        userId: "user-det-eng",
        tenantId: "tenant-acme",
        role: "engineer",
        plantIds: ["plant-detroit"],
        email: "engineer@acme.demo",
        name: "Marcus Vance (Floor Engineer)"
      },
      { tokenVersion: 1 }
    );

    const wrongCur = await changePasswordPost(
      new Request("http://localhost/api/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${engineerTokenV1}`
        },
        body: JSON.stringify({
          currentPassword: "wrong-password-attempt",
          newPassword: "StrongNewPassword#2026"
        })
      })
    );
    expect(wrongCur.status).toBe(403);

    const weakPw = await changePasswordPost(
      new Request("http://localhost/api/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${engineerTokenV1}`
        },
        body: JSON.stringify({
          currentPassword: "lutic-demo-password",
          newPassword: "aaaaaaaaaaaa"
        })
      })
    );
    expect(weakPw.status).toBe(400);

    const okChange = await changePasswordPost(
      new Request("http://localhost/api/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${engineerTokenV1}`
        },
        body: JSON.stringify({
          currentPassword: "lutic-demo-password",
          newPassword: "UniquePlantPass!2026"
        })
      })
    );
    expect(okChange.status).toBe(200);
    const changedJson = (await okChange.json()) as { token: string };
    expect(changedJson.token).toBeTruthy();

    // Old engineer token must immediately fail on authenticated routes
    const staleAttempt = await diagnosticsGet(
      new Request("http://localhost/api/admin/diagnostics", {
        headers: { authorization: `Bearer ${engineerTokenV1}` }
      })
    );
    expect(staleAttempt.status).toBe(401);

    // Admin resets engineer password and verifies audit log is redacted
    const adminToken = await signSessionToken(
      {
        userId: "user-admin",
        tenantId: "tenant-acme",
        role: "admin",
        plantIds: ["plant-detroit", "plant-austin"],
        email: "admin@acme.demo",
        name: "Admin"
      },
      { tokenVersion: 1 }
    );

    const resetSecret = "AdminResetSecret!9876";
    const adminResetRes = await adminUsersPatch(
      new Request("http://localhost/api/admin/users", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ userId: "user-det-eng", password: resetSecret })
      })
    );
    expect(adminResetRes.status).toBe(200);

    // Previous refreshed engineer token from change-password must now be revoked by admin reset
    const afterAdminReset = await changePasswordPost(
      new Request("http://localhost/api/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${changedJson.token}`
        },
        body: JSON.stringify({
          currentPassword: resetSecret,
          newPassword: "AnotherValidPass!2026"
        })
      })
    );
    expect(afterAdminReset.status).toBe(401);

    // Verify plaintext password does NOT appear anywhere in audit_log
    const logs = await conn.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, "tenant-acme"), eq(auditLog.action, "admin_update_user")));
    expect(JSON.stringify(logs)).not.toContain(resetSecret);
    expect(logs.some((entry) => entry.args?.passwordReset === true)).toBe(true);

    // Deactivating last active admin returns 409 Last Administrator
    const disableOnlyAdmin = await adminUsersPatch(
      new Request("http://localhost/api/admin/users", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ userId: "user-admin", active: false })
      })
    );
    expect(disableOnlyAdmin.status).toBe(409);

    const listUsers = await adminUsersGet(
      new Request("http://localhost/api/admin/users", {
        headers: { authorization: `Bearer ${adminToken}` }
      })
    );
    expect(listUsers.status).toBe(200);
    const listJson = (await listUsers.json()) as {
      users: Array<{ id: string; tokenVersion?: number; passwordUpdatedAt?: string | null }>;
    };
    const engRow = listJson.users.find((u) => u.id === "user-det-eng");
    expect(engRow?.tokenVersion).toBe(3);
    expect(engRow?.passwordUpdatedAt).toBeTruthy();
  });

  it("blocks cross-tenant and cross-plant shared conversation links", async () => {
    const shareToken = "share-tok-detroit-only";
    await conn.db.insert(conversations).values({
      id: "conv-share-detroit",
      tenantId: "tenant-acme",
      userId: "user-admin",
      machineId: "mach-l3-filler-01",
      title: "Detroit Filler Share",
      shareToken
    });

    const austinToken = await signSessionToken(
      {
        userId: "user-aus-eng",
        tenantId: "tenant-acme",
        role: "engineer",
        plantIds: ["plant-austin"],
        email: "austin.engineer@acme.demo",
        name: "Elena Rostova (Austin Engineer)"
      },
      { tokenVersion: 1 }
    );
    const betaToken = await signSessionToken(
      {
        userId: "user-beta-admin",
        tenantId: "tenant-beta",
        role: "admin",
        plantIds: ["plant-beta-01"],
        email: "user@beta.demo",
        name: "Beta Operations Lead"
      },
      { tokenVersion: 1 }
    );
    const detroitManagerToken = await signSessionToken(
      {
        userId: "user-manager",
        tenantId: "tenant-acme",
        role: "manager",
        plantIds: ["plant-detroit", "plant-austin"],
        email: "manager@acme.demo",
        name: "Sarah Chen (Plant Director)"
      },
      { tokenVersion: 1 }
    );

    const crossTenant = await sharedConvGet(
      new Request(`http://localhost/api/conversations/share/${shareToken}`, {
        headers: { authorization: `Bearer ${betaToken}` }
      }),
      { params: Promise.resolve({ token: shareToken }) }
    );
    expect(crossTenant.status).toBe(404);

    const crossPlant = await sharedConvGet(
      new Request(`http://localhost/api/conversations/share/${shareToken}`, {
        headers: { authorization: `Bearer ${austinToken}` }
      }),
      { params: Promise.resolve({ token: shareToken }) }
    );
    expect(crossPlant.status).toBe(403);

    const allowedSamePlant = await sharedConvGet(
      new Request(`http://localhost/api/conversations/share/${shareToken}`, {
        headers: { authorization: `Bearer ${detroitManagerToken}` }
      }),
      { params: Promise.resolve({ token: shareToken }) }
    );
    expect(allowedSamePlant.status).toBe(200);

    // General shared conversation (machineId: null) still enforces plant overlap with creator
    const detGeneralShare = `share-gen-${crypto.randomUUID().slice(0, 8)}`;
    await conn.db.insert(conversations).values({
      id: `conv-gen-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: "tenant-acme",
      userId: "user-det-eng",
      title: "General Detroit Shift Notes",
      shareToken: detGeneralShare
    });
    const crossPlantGeneral = await sharedConvGet(
      new Request(`http://localhost/api/conversations/share/${detGeneralShare}`, {
        headers: { authorization: `Bearer ${austinToken}` }
      }),
      { params: Promise.resolve({ token: detGeneralShare }) }
    );
    expect(crossPlantGeneral.status).toBe(403);

    const samePlantGeneral = await sharedConvGet(
      new Request(`http://localhost/api/conversations/share/${detGeneralShare}`, {
        headers: { authorization: `Bearer ${detroitManagerToken}` }
      }),
      { params: Promise.resolve({ token: detGeneralShare }) }
    );
    expect(samePlantGeneral.status).toBe(200);

    // Shared conversation referencing a deleted/missing machineId fails closed with 404
    const orphanShare = `share-orphan-${crypto.randomUUID().slice(0, 8)}`;
    await conn.db.insert(conversations).values({
      id: `conv-orphan-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: "tenant-acme",
      userId: "user-det-eng",
      machineId: "mach-deleted-missing",
      title: "Orphaned Machine Thread",
      shareToken: orphanShare
    });
    const orphanRes = await sharedConvGet(
      new Request(`http://localhost/api/conversations/share/${orphanShare}`, {
        headers: { authorization: `Bearer ${detroitManagerToken}` }
      }),
      { params: Promise.resolve({ token: orphanShare }) }
    );
    expect(orphanRes.status).toBe(404);
  });

  it("cancels agent turn and chat endpoint cleanly on AbortSignal and rejects oversized chat bodies", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Client aborted", "AbortError"));

    await expect(
      runAgentTurn({
        db: conn.db,
        user: {
          userId: "user-admin",
          tenantId: "tenant-acme",
          role: "admin",
          plantIds: ["plant-detroit", "plant-austin"],
          email: "admin@acme.demo",
          name: "Admin"
        },
        message: "Why is Line 3 failing?",
        conversationId: "conv-abort-test",
        abortSignal: controller.signal
      })
    ).rejects.toThrow();

    const adminToken = await signSessionToken(
      {
        userId: "user-admin",
        tenantId: "tenant-acme",
        role: "admin",
        plantIds: ["plant-detroit", "plant-austin"],
        email: "admin@acme.demo",
        name: "Admin"
      },
      { tokenVersion: 1 }
    );

    const chatAbortRes = await chatPost(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ message: "Explain E42" }),
        signal: controller.signal
      })
    );
    expect(chatAbortRes.status).toBe(499);

    const bigRes = await chatPost(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(5 * 1024 * 1024),
          authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ message: "hi" })
      })
    );
    expect(bigRes.status).toBe(413);
  });

  it("separates health/live from admin diagnostics and enforces tenant-scoped retention cleanup", async () => {
    const live = await liveHealthGet();
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ ok: true, service: "lutic-web" });

    const managerToken = await signSessionToken(
      {
        userId: "user-manager",
        tenantId: "tenant-acme",
        role: "manager",
        plantIds: ["plant-detroit"],
        email: "manager@acme.demo",
        name: "Sarah Chen (Plant Director)"
      },
      { tokenVersion: 1 }
    );
    const adminToken = await signSessionToken(
      {
        userId: "user-admin",
        tenantId: "tenant-acme",
        role: "admin",
        plantIds: ["plant-detroit", "plant-austin"],
        email: "admin@acme.demo",
        name: "Admin"
      },
      { tokenVersion: 1 }
    );

    expect(
      (
        await diagnosticsGet(
          new Request("http://localhost/api/admin/diagnostics", {
            headers: { authorization: `Bearer ${managerToken}` }
          })
        )
      ).status
    ).toBe(403);

    const diagRes = await diagnosticsGet(
      new Request("http://localhost/api/admin/diagnostics", {
        headers: { authorization: `Bearer ${adminToken}` }
      })
    );
    expect(diagRes.status).toBe(200);
    const diagJson = (await diagRes.json()) as {
      database: { status: string; latencyMs: number };
      migrations: { currentVersion: number };
      telemetry: { totalMachines: number };
      queues: { ready: number; inFlight: number; deadLetter: number };
    };
    expect(diagJson.database.status).toBe("ok");
    expect(diagJson.migrations.currentVersion).toBe(3);
    expect(diagJson.telemetry.totalMachines).toBeGreaterThan(0);

    // Retention isolation: insert old records in both tenant-acme and tenant-beta
    const oldDate = new Date(Date.now() - 200 * 86_400_000);
    await conn.db.insert(notifications).values([
      {
        id: "notif-old-acme",
        tenantId: "tenant-acme",
        channel: "in_app",
        severity: "info",
        title: "Old Acme",
        body: "Should be pruned",
        read: true,
        createdAt: oldDate
      },
      {
        id: "notif-old-beta",
        tenantId: "tenant-beta",
        channel: "in_app",
        severity: "info",
        title: "Old Beta",
        body: "Must stay intact",
        read: true,
        createdAt: oldDate
      }
    ]);
    await conn.db.insert(usageLog).values({
      id: "usage-old-acme",
      tenantId: "tenant-acme",
      userId: "user-admin",
      role: "admin",
      model: "mock",
      promptTokens: 1,
      completionTokens: 1,
      estimatedCostUsd: 0,
      createdAt: oldDate
    });
    await conn.db.insert(workflows).values({
      id: "wf-ret-test",
      tenantId: "tenant-acme",
      name: "Retention WF",
      definition: { nodes: [], edges: [] },
      createdBy: "user-admin"
    });
    await conn.db.insert(workflowRuns).values({
      id: "wfrun-old-acme",
      tenantId: "tenant-acme",
      workflowId: "wf-ret-test",
      status: "succeeded",
      startedAt: oldDate
    });

    const retRes = await retentionPost(
      new Request("http://localhost/api/admin/retention", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ retentionDays: 90 })
      })
    );
    expect(retRes.status).toBe(200);
    const retJson = (await retRes.json()) as {
      tenantId: string;
      notificationsDeleted: number;
      usageLogsDeleted: number;
      workflowRunsDeleted: number;
    };
    expect(retJson.tenantId).toBe("tenant-acme");
    expect(retJson.notificationsDeleted).toBeGreaterThanOrEqual(1);
    expect(retJson.usageLogsDeleted).toBeGreaterThanOrEqual(1);
    expect(retJson.workflowRunsDeleted).toBeGreaterThanOrEqual(1);

    const betaNotifs = await conn.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, "notif-old-beta"));
    expect(betaNotifs).toHaveLength(1);
  });

  it("enforces plant-scoped gateway ingestion tokens with rotation, expiry, revocation, and login isolation", async () => {
    const adminToken = await signSessionToken(
      {
        userId: "user-admin",
        tenantId: "tenant-acme",
        role: "admin",
        plantIds: ["plant-detroit", "plant-austin"],
        email: "admin@acme.demo",
        name: "Admin"
      },
      { tokenVersion: 1 }
    );

    const createRes = await ingestionTokensPost(
      new Request("http://localhost/api/admin/ingestion-tokens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          plantId: "plant-detroit",
          name: "Detroit PLC Gateway",
          expiresInDays: 30
        })
      })
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      token: string;
      record: { id: string; plantId: string; tokenPrefix: string };
    };
    expect(created.token.startsWith("kjt_")).toBe(true);
    expect(created.record.plantId).toBe("plant-detroit");

    // Token secret itself is never stored in DB
    const [storedTok] = await conn.db
      .select()
      .from(ingestionTokens)
      .where(eq(ingestionTokens.id, created.record.id));
    expect(storedTok?.tokenHash).not.toBe(created.token);
    expect(storedTok?.tokenHash).toHaveLength(64);

    // Gateway ingestion tokens CANNOT authenticate admin/UI session endpoints
    const adminAttempt = await adminUsersGet(
      new Request("http://localhost/api/admin/users", {
        headers: { authorization: `Bearer ${created.token}` }
      })
    );
    expect(adminAttempt.status).toBe(401);

    // Valid ingestion into authorized Detroit machine succeeds & tracks replay + lastUsedAt
    const nowIso = new Date(Date.now() - 2000).toISOString();
    const okIngest = await telemetryPost(
      new Request("http://localhost/api/telemetry", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${created.token}`
        },
        body: JSON.stringify({
          samples: [
            {
              sampleId: "gw-det-1",
              machineId: "mach-l3-filler-01",
              recordedAt: nowIso,
              status: "running",
              temperature: 44.1,
              vibration: 1.5,
              pressure: 6.1,
              currentSpeed: 93
            },
            {
              sampleId: "gw-det-1",
              machineId: "mach-l3-filler-01",
              recordedAt: nowIso,
              status: "running",
              temperature: 44.1,
              vibration: 1.5,
              pressure: 6.1,
              currentSpeed: 93
            }
          ]
        })
      })
    );
    expect(okIngest.status).toBe(200);
    expect(await okIngest.json()).toMatchObject({ acceptedSamples: 1, duplicateSamples: 1 });

    // Cross-plant batch containing Austin machine MUST be rejected 403 without writing Detroit sample
    const crossPlantIngest = await telemetryPost(
      new Request("http://localhost/api/telemetry", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${created.token}`
        },
        body: JSON.stringify({
          samples: [
            {
              sampleId: "gw-cross-1",
              machineId: "mach-l3-filler-01",
              recordedAt: nowIso,
              status: "running",
              temperature: 44.1,
              vibration: 1.5,
              pressure: 6.1,
              currentSpeed: 93
            },
            {
              sampleId: "gw-cross-2",
              machineId: "mach-aus-press-02",
              recordedAt: nowIso,
              status: "running",
              temperature: 44.1,
              vibration: 1.5,
              pressure: 6.1,
              currentSpeed: 93
            }
          ]
        })
      })
    );
    expect(crossPlantIngest.status).toBe(403);
    const forbiddenBatchTempId = `telemetry-${sha256Hex(
      JSON.stringify(["tenant-acme", "mach-l3-filler-01", "gw-cross-1"])
    )}-temperature`;
    const leaked = await conn.db
      .select()
      .from(readings)
      .where(eq(readings.id, forbiddenBatchTempId));
    expect(leaked).toHaveLength(0);

    // Rotate token -> old secret immediately 401, new secret 200
    const rotateRes = await ingestionTokensPatch(
      new Request("http://localhost/api/admin/ingestion-tokens", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ id: created.record.id, action: "rotate" })
      })
    );
    expect(rotateRes.status).toBe(200);
    const rotated = (await rotateRes.json()) as { token: string; record: { id: string } };

    const oldAfterRotate = await telemetryPost(
      new Request("http://localhost/api/telemetry", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${created.token}`
        },
        body: JSON.stringify({
          samples: [
            {
              sampleId: "gw-stale-tok",
              machineId: "mach-l3-filler-01",
              recordedAt: nowIso,
              status: "running",
              temperature: 44.1,
              vibration: 1.5,
              pressure: 6.1,
              currentSpeed: 93
            }
          ]
        })
      })
    );
    expect(oldAfterRotate.status).toBe(401);

    const newAfterRotate = await telemetryPost(
      new Request("http://localhost/api/telemetry", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${rotated.token}`
        },
        body: JSON.stringify({
          samples: [
            {
              sampleId: "gw-new-tok-1",
              machineId: "mach-l3-filler-01",
              recordedAt: nowIso,
              status: "running",
              temperature: 44.3,
              vibration: 1.4,
              pressure: 6.3,
              currentSpeed: 94
            }
          ]
        })
      })
    );
    expect(newAfterRotate.status).toBe(200);

    // Revoke rotated token -> 401
    const revokeRes = await ingestionTokensPatch(
      new Request("http://localhost/api/admin/ingestion-tokens", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ id: rotated.record.id, action: "revoke" })
      })
    );
    expect(revokeRes.status).toBe(200);

    const revokedAttempt = await telemetryPost(
      new Request("http://localhost/api/telemetry", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${rotated.token}`
        },
        body: JSON.stringify({
          samples: [
            {
              sampleId: "gw-revoked",
              machineId: "mach-l3-filler-01",
              recordedAt: nowIso,
              status: "running",
              temperature: 44.3,
              vibration: 1.4,
              pressure: 6.3,
              currentSpeed: 94
            }
          ]
        })
      })
    );
    expect(revokedAttempt.status).toBe(401);

    // Rotating an already-revoked token must be rejected with 409 Conflict
    const rotateRevokedRes = await ingestionTokensPatch(
      new Request("http://localhost/api/admin/ingestion-tokens", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ id: rotated.record.id, action: "rotate" })
      })
    );
    expect(rotateRevokedRes.status).toBe(409);

    // Expired token -> 401
    await conn.db
      .update(ingestionTokens)
      .set({ active: true, revokedAt: null, expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(ingestionTokens.id, rotated.record.id));
    const expiredAttempt = await telemetryPost(
      new Request("http://localhost/api/telemetry", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${rotated.token}`
        },
        body: JSON.stringify({
          samples: [
            {
              sampleId: "gw-expired",
              machineId: "mach-l3-filler-01",
              recordedAt: nowIso,
              status: "running",
              temperature: 44.3,
              vibration: 1.4,
              pressure: 6.3,
              currentSpeed: 94
            }
          ]
        })
      })
    );
    expect(expiredAttempt.status).toBe(401);

    // Admin list returns only metadata (never raw secrets or hashes)
    const listTok = await ingestionTokensGet(
      new Request("http://localhost/api/admin/ingestion-tokens", {
        headers: { authorization: `Bearer ${adminToken}` }
      })
    );
    expect(listTok.status).toBe(200);
    const listText = await listTok.text();
    expect(listText).not.toContain(rotated.token);
    expect(listText).not.toContain("tokenHash");
  });

  it("returns 404 on demo-switch when LUTIC_DEMO_MODE=false or production, maps LLM timeouts to 504, and enforces user create password entropy", async () => {
    const prevDemo = process.env.LUTIC_DEMO_MODE;
    const prevEnv = process.env.NODE_ENV;
    const prevAllow = process.env.ALLOW_DEMO_SWITCH;
    try {
      process.env.LUTIC_DEMO_MODE = "false";
      const demoOffRes = await demoSwitchPost(
        new Request("http://localhost/api/auth/demo-switch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "engineer@acme.demo" })
        })
      );
      expect(demoOffRes.status).toBe(404);

      delete process.env.LUTIC_DEMO_MODE;
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      const prodRes = await demoSwitchPost(
        new Request("http://localhost/api/auth/demo-switch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "engineer@acme.demo" })
        })
      );
      expect(prodRes.status).toBe(404);

      (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
      process.env.ALLOW_DEMO_SWITCH = "false";
      const allowOffRes = await demoSwitchPost(
        new Request("http://localhost/api/auth/demo-switch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "engineer@acme.demo" })
        })
      );
      expect(allowOffRes.status).toBe(404);
    } finally {
      if (prevDemo === undefined) delete process.env.LUTIC_DEMO_MODE;
      else process.env.LUTIC_DEMO_MODE = prevDemo;
      (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
      if (prevAllow === undefined) delete process.env.ALLOW_DEMO_SWITCH;
      else process.env.ALLOW_DEMO_SWITCH = prevAllow;
    }

    // Timeout error maps cleanly to 504 Upstream Timeout and MockLLMProvider respects AbortSignal
    const timeoutRes = handleApiError(new LLMTimeoutError("LLM request timed out"));
    expect(timeoutRes.status).toBe(504);

    const ac = new AbortController();
    ac.abort();
    const mockProvider = new MockLLMProvider();
    await expect(
      mockProvider.generateStep({
        systemPrompt: "sys",
        userMessage: "hello",
        history: [],
        tools: [],
        observations: [],
        user: {
          userId: "user-admin",
          tenantId: "tenant-acme",
          role: "admin",
          plantIds: ["plant-detroit"],
          email: "admin@acme.demo",
          name: "Admin"
        },
        abortSignal: ac.signal
      })
    ).rejects.toMatchObject({ name: "AbortError" });

    // POST /api/admin/users rejects low-entropy and whitespace-padded passwords
    const adminToken = await signSessionToken(
      {
        userId: "user-admin",
        tenantId: "tenant-acme",
        role: "admin",
        plantIds: ["plant-detroit", "plant-austin"],
        email: "admin@acme.demo",
        name: "Admin"
      },
      { tokenVersion: 1 }
    );
    const lowEntropyRes = await adminUsersPost(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          email: "weak@acme.demo",
          name: "Weak Pass",
          role: "engineer",
          plantIds: ["plant-detroit"],
          password: "aaaaaaaaaaaa"
        })
      })
    );
    expect(lowEntropyRes.status).toBe(400);

    const paddedRes = await adminUsersPost(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          email: "padded@acme.demo",
          name: "Padded Pass",
          role: "engineer",
          plantIds: ["plant-detroit"],
          password: "  Unique-Passphrase-999  "
        })
      })
    );
    expect(paddedRes.status).toBe(400);
  });

  it("enforces all-plant authorization on shared conversations including toolCalls and single-plant admins", async () => {
    await conn.db.insert(users).values({
      id: "user-det-only-admin",
      tenantId: "tenant-acme",
      email: "det.admin@acme.demo",
      name: "Detroit Only Admin",
      passwordHash: "scrypt$00$00",
      role: "admin",
      active: true
    });
    await conn.db.insert(userPlants).values({
      tenantId: "tenant-acme",
      userId: "user-det-only-admin",
      plantId: "plant-detroit"
    });

    const multiPlantShare = `share-multi-${crypto.randomUUID().slice(0, 8)}`;
    await conn.db.insert(conversations).values({
      id: `conv-multi-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: "tenant-acme",
      userId: "user-analyst",
      title: "Dual-Plant Shift Handover",
      shareToken: multiPlantShare
    });

    const detMgrToken = await signSessionToken(
      {
        userId: "user-det-mgr",
        tenantId: "tenant-acme",
        role: "manager",
        plantIds: ["plant-detroit"],
        email: "detroit.manager@acme.demo",
        name: "Carlos Vega (Detroit Manager)"
      },
      { tokenVersion: 1 }
    );
    const detOnlyAdminToken = await signSessionToken(
      {
        userId: "user-det-only-admin",
        tenantId: "tenant-acme",
        role: "admin",
        plantIds: ["plant-detroit"],
        email: "det.admin@acme.demo",
        name: "Detroit Only Admin"
      },
      { tokenVersion: 1 }
    );
    const dualMgrToken = await signSessionToken(
      {
        userId: "user-manager",
        tenantId: "tenant-acme",
        role: "manager",
        plantIds: ["plant-detroit", "plant-austin"],
        email: "manager@acme.demo",
        name: "Sarah Chen (Plant Director)"
      },
      { tokenVersion: 1 }
    );

    expect(
      (
        await sharedConvGet(
          new Request(`http://localhost/api/conversations/share/${multiPlantShare}`, {
            headers: { authorization: `Bearer ${detMgrToken}` }
          }),
          { params: Promise.resolve({ token: multiPlantShare }) }
        )
      ).status
    ).toBe(403);

    expect(
      (
        await sharedConvGet(
          new Request(`http://localhost/api/conversations/share/${multiPlantShare}`, {
            headers: { authorization: `Bearer ${detOnlyAdminToken}` }
          }),
          { params: Promise.resolve({ token: multiPlantShare }) }
        )
      ).status
    ).toBe(403);

    expect(
      (
        await sharedConvGet(
          new Request(`http://localhost/api/conversations/share/${multiPlantShare}`, {
            headers: { authorization: `Bearer ${dualMgrToken}` }
          }),
          { params: Promise.resolve({ token: multiPlantShare }) }
        )
      ).status
    ).toBe(200);

    // Unscoped conversation with a message referencing an Austin machine via toolCalls
    const toolRefConvId = `conv-toolref-${crypto.randomUUID().slice(0, 8)}`;
    const toolRefShare = `share-toolref-${crypto.randomUUID().slice(0, 8)}`;
    await conn.db.insert(conversations).values({
      id: toolRefConvId,
      tenantId: "tenant-acme",
      userId: "user-det-mgr",
      title: "Machine Lookup Thread",
      shareToken: toolRefShare
    });
    await conn.db.insert(messages).values({
      id: `msg-toolref-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: "tenant-acme",
      conversationId: toolRefConvId,
      role: "assistant",
      content: "Checked compressor",
      toolCalls: [
        {
          toolName: "historian.get_machine_status",
          args: { machineId: "mach-aus-comp-01" },
          status: "allowed"
        }
      ]
    });

    expect(
      (
        await sharedConvGet(
          new Request(`http://localhost/api/conversations/share/${toolRefShare}`, {
            headers: { authorization: `Bearer ${detMgrToken}` }
          }),
          { params: Promise.resolve({ token: toolRefShare }) }
        )
      ).status
    ).toBe(403);

    expect(
      (
        await sharedConvGet(
          new Request(`http://localhost/api/conversations/share/${toolRefShare}`, {
            headers: { authorization: `Bearer ${dualMgrToken}` }
          }),
          { params: Promise.resolve({ token: toolRefShare }) }
        )
      ).status
    ).toBe(200);
  });

  it("atomically bumps tokenVersion and invalidates prior sessions when role or plantIds change", async () => {
    const adminToken = await signSessionToken(
      {
        userId: "user-admin",
        tenantId: "tenant-acme",
        role: "admin",
        plantIds: ["plant-detroit", "plant-austin"],
        email: "admin@acme.demo",
        name: "Admin"
      },
      { tokenVersion: 1 }
    );

    const createRes = await adminUsersPost(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          email: "role.shift@acme.demo",
          name: "Role Shift User",
          role: "engineer",
          plantIds: ["plant-detroit"],
          password: "UniqueShiftUser!2026"
        })
      })
    );
    expect(createRes.status).toBe(201);
    const { id: targetId } = (await createRes.json()) as { id: string };

    const tokenV1 = await signSessionToken(
      {
        userId: targetId,
        tenantId: "tenant-acme",
        role: "engineer",
        plantIds: ["plant-detroit"],
        email: "role.shift@acme.demo",
        name: "Role Shift User"
      },
      { tokenVersion: 1 }
    );

    expect(
      (
        await conversationsGet(
          new Request("http://localhost/api/conversations", {
            headers: { authorization: `Bearer ${tokenV1}` }
          })
        )
      ).status
    ).toBe(200);

    // Changing role bumps tokenVersion 1 -> 2
    const rolePatch = await adminUsersPatch(
      new Request("http://localhost/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ userId: targetId, role: "analyst" })
      })
    );
    expect(rolePatch.status).toBe(200);

    expect(
      (
        await conversationsGet(
          new Request("http://localhost/api/conversations", {
            headers: { authorization: `Bearer ${tokenV1}` }
          })
        )
      ).status
    ).toBe(401);

    const tokenV2 = await signSessionToken(
      {
        userId: targetId,
        tenantId: "tenant-acme",
        role: "analyst",
        plantIds: ["plant-detroit"],
        email: "role.shift@acme.demo",
        name: "Role Shift User"
      },
      { tokenVersion: 2 }
    );

    expect(
      (
        await conversationsGet(
          new Request("http://localhost/api/conversations", {
            headers: { authorization: `Bearer ${tokenV2}` }
          })
        )
      ).status
    ).toBe(200);

    // Changing plantIds bumps tokenVersion 2 -> 3
    const plantPatch = await adminUsersPatch(
      new Request("http://localhost/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ userId: targetId, plantIds: ["plant-detroit", "plant-austin"] })
      })
    );
    expect(plantPatch.status).toBe(200);

    expect(
      (
        await conversationsGet(
          new Request("http://localhost/api/conversations", {
            headers: { authorization: `Bearer ${tokenV2}` }
          })
        )
      ).status
    ).toBe(401);

    const [finalRow] = await conn.db.select().from(users).where(eq(users.id, targetId));
    expect(finalRow?.tokenVersion).toBe(3);
  });

  it("validates previous auth and encryption keys in validateProductionConfig and rejects duplicates or weak keys", () => {
    const baseEnv: NodeJS.ProcessEnv = {
      DATABASE_URL: "postgresql://produser:UniquePgPass2026!@db.internal:5432/lutic_prod",
      AUTH_SECRET: "active-auth-secret-with-unique-characters-0123456789",
      CREDENTIAL_ENCRYPTION_KEY: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
      LICENSE_ENFORCE: "false"
    };

    expect(() =>
      validateProductionConfig({
        ...baseEnv,
        AUTH_SECRET_PREVIOUS: "prior-auth-secret-with-unique-characters-9876543210",
        CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS:
          "b1c2d3e4f5061728394a5b6c7d8e9f01b1c2d3e4f5061728394a5b6c7d8e9f01"
      })
    ).not.toThrow();

    expect(() =>
      validateProductionConfig({
        ...baseEnv,
        AUTH_SECRET_PREVIOUS: "weak"
      })
    ).toThrow(/AUTH_SECRET_PREVIOUS/);

    expect(() =>
      validateProductionConfig({
        ...baseEnv,
        AUTH_SECRET_PREVIOUS: baseEnv.AUTH_SECRET
      })
    ).toThrow(/duplicate AUTH_SECRET/i);

    expect(() =>
      validateProductionConfig({
        ...baseEnv,
        CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS: "not-a-valid-hex-key"
      })
    ).toThrow(/CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS/);

    expect(() =>
      validateProductionConfig({
        ...baseEnv,
        CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS: baseEnv.CREDENTIAL_ENCRYPTION_KEY!.toUpperCase()
      })
    ).toThrow(/duplicate CREDENTIAL_ENCRYPTION_KEY/i);
  });

  it("serializes concurrent token rotations/revocations and password vs permission refreshes without split successors or stale claims", async () => {
    const adminToken = await signSessionToken(
      {
        userId: "user-admin",
        tenantId: "tenant-acme",
        role: "admin",
        plantIds: ["plant-detroit", "plant-austin"],
        email: "admin@acme.demo",
        name: "Admin"
      },
      { tokenVersion: 1 }
    );

    // 1. Concurrent rotation vs rotation on the same ingestion token creates strictly 1 successor
    const tokCreateA = await ingestionTokensPost(
      new Request("http://localhost/api/admin/ingestion-tokens", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ plantId: "plant-detroit", name: "Race Token A", expiresInDays: 30 })
      })
    );
    expect(tokCreateA.status).toBe(201);
    const { record: recA } = (await tokCreateA.json()) as { record: { id: string } };

    const [rot1, rot2] = await Promise.all([
      ingestionTokensPatch(
        new Request("http://localhost/api/admin/ingestion-tokens", {
          method: "PATCH",
          headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ id: recA.id, action: "rotate" })
        })
      ),
      ingestionTokensPatch(
        new Request("http://localhost/api/admin/ingestion-tokens", {
          method: "PATCH",
          headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ id: recA.id, action: "rotate" })
        })
      )
    ]);
    expect([rot1.status, rot2.status].sort()).toEqual([200, 409]);

    const successorsA = await conn.db
      .select()
      .from(ingestionTokens)
      .where(eq(ingestionTokens.rotatedFromId, recA.id));
    expect(successorsA).toHaveLength(1);
    expect(successorsA[0]!.active).toBe(true);

    // 2. Concurrent rotate vs revoke leaves at most 1 successor and never leaves original token active
    const tokCreateB = await ingestionTokensPost(
      new Request("http://localhost/api/admin/ingestion-tokens", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ plantId: "plant-detroit", name: "Race Token B", expiresInDays: 30 })
      })
    );
    expect(tokCreateB.status).toBe(201);
    const { token: rawB, record: recB } = (await tokCreateB.json()) as {
      token: string;
      record: { id: string };
    };

    const [rotB, revB] = await Promise.all([
      ingestionTokensPatch(
        new Request("http://localhost/api/admin/ingestion-tokens", {
          method: "PATCH",
          headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ id: recB.id, action: "rotate" })
        })
      ),
      ingestionTokensPatch(
        new Request("http://localhost/api/admin/ingestion-tokens", {
          method: "PATCH",
          headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ id: recB.id, action: "revoke" })
        })
      )
    ]);
    expect(revB.status).toBe(200);
    expect([200, 409]).toContain(rotB.status);

    const successorsB = await conn.db
      .select()
      .from(ingestionTokens)
      .where(eq(ingestionTokens.rotatedFromId, recB.id));
    expect(successorsB.length).toBeLessThanOrEqual(1);
    if (rotB.status === 409) expect(successorsB).toHaveLength(0);

    const retryOldB = await telemetryPost(
      new Request("http://localhost/api/telemetry", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${rawB}` },
        body: JSON.stringify({
          samples: [
            {
              sampleId: "race-revoked-b",
              machineId: "mach-l3-filler-01",
              recordedAt: new Date(Date.now() - 1000).toISOString(),
              status: "running",
              temperature: 42,
              vibration: 1.2,
              pressure: 6,
              currentSpeed: 90
            }
          ]
        })
      })
    );
    expect(retryOldB.status).toBe(401);

    // 3. Concurrent password change vs admin role/plant update + refreshed session scope verification
    const initialPw = "InitialRaceSecret!2026";
    const nextPw = "RotatedRaceSecret!2026";
    const raceUserRes = await adminUsersPost(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          email: "race.user@acme.demo",
          name: "Race User",
          role: "engineer",
          plantIds: ["plant-detroit"],
          password: initialPw
        })
      })
    );
    expect(raceUserRes.status).toBe(201);
    const { id: raceUserId } = (await raceUserRes.json()) as { id: string };

    const raceTokV1 = await signSessionToken(
      {
        userId: raceUserId,
        tenantId: "tenant-acme",
        role: "engineer",
        plantIds: ["plant-detroit"],
        email: "race.user@acme.demo",
        name: "Race User"
      },
      { tokenVersion: 1 }
    );

    const [adminUpdRes, pwChangeRes] = await Promise.all([
      adminUsersPatch(
        new Request("http://localhost/api/admin/users", {
          method: "PATCH",
          headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({
            userId: raceUserId,
            role: "analyst",
            plantIds: ["plant-detroit", "plant-austin"]
          })
        })
      ),
      changePasswordPost(
        new Request("http://localhost/api/auth/change-password", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${raceTokV1}` },
          body: JSON.stringify({ currentPassword: initialPw, newPassword: nextPw })
        })
      )
    ]);

    expect(adminUpdRes.status).toBe(200);
    expect([200, 401, 409]).toContain(pwChangeRes.status);

    // Old v1 token must always be invalid after role/plant change and/or password change
    expect(
      (
        await conversationsGet(
          new Request("http://localhost/api/conversations", {
            headers: { authorization: `Bearer ${raceTokV1}` }
          })
        )
      ).status
    ).toBe(401);

    // Subsequent password change at current tokenVersion mints a fresh token carrying final DB role & plantIds
    const [curUserRow] = await conn.db.select().from(users).where(eq(users.id, raceUserId));
    expect(curUserRow?.role).toBe("analyst");
    expect(curUserRow?.tokenVersion).toBeGreaterThanOrEqual(2);

    const currentTok = await signSessionToken(
      {
        userId: raceUserId,
        tenantId: "tenant-acme",
        role: "analyst",
        plantIds: ["plant-detroit"], // intentionally stale plantIds in JWT to test DB re-read on refresh
        email: "race.user@acme.demo",
        name: "Race User"
      },
      { tokenVersion: curUserRow!.tokenVersion }
    );

    const followUpChange = await changePasswordPost(
      new Request("http://localhost/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${currentTok}` },
        body: JSON.stringify({
          currentPassword: pwChangeRes.status === 200 ? nextPw : initialPw,
          newPassword: "FinalConfirmedSecret!2026"
        })
      })
    );
    expect(followUpChange.status).toBe(200);
    const { token: freshToken } = (await followUpChange.json()) as { token: string };
    const claims = await verifySessionToken(freshToken);
    expect(claims?.role).toBe("analyst");
    expect(claims?.plantIds.slice().sort()).toEqual(["plant-austin", "plant-detroit"]);
    expect(claims?.tokenVersion).toBe(curUserRow!.tokenVersion + 1);
  });
});
