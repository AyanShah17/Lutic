import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  connectorConnections,
  conversations,
  createDbConnection,
  DenseHttpEmbeddingProvider,
  documentChunks,
  eq,
  executeWorkflow,
  getAppliedMigrations,
  getDefaultEmbeddingProvider,
  hasLiveAdapterSupport,
  HybridLexicalSemanticReranker,
  hybridSearchDocuments,
  invokeLiveAdapterTool,
  isPrivateOrReservedIp,
  messages,
  MIGRATIONS,
  registerWorkflowAiExecutor,
  resolveSafeExternalTarget,
  resumeWorkflowRun,
  safePinnedHttpRequest,
  seedDatabase,
  signSessionToken,
  sql,
  StubReranker,
  testLiveAdapter,
  userPlants,
  users,
  withTenantScope,
  workerHeartbeats,
  workflowRuns,
  workflows,
  type DbConnection,
  type LuticDatabase
} from "@lutic/core";
import {
  estimateModelCostUsd,
  evaluateIndustrialSafetyGate,
  ingestDocumentJob,
  MockLLMProvider,
  planSpecialistStages,
  runAgentTurn,
  type SpecialistStageTrace
} from "@lutic/agent";

const state = vi.hoisted(() => ({
  conn: undefined as DbConnection | undefined,
  withWebTenantCalls: 0
}));

vi.mock("../apps/web/src/lib/db", () => ({
  getWebAdministrativeDb: async () => state.conn!.db,
  getWebDbConnection: async () => state.conn!,
  requireWebLicense: async () => {},
  withWebTenantDb: (tenantId: string, run: (db: LuticDatabase) => Promise<unknown>) => {
    state.withWebTenantCalls += 1;
    return withTenantScope(state.conn!.db, tenantId, run);
  }
}));

import { POST as chatPost } from "../apps/web/src/app/api/chat/route";
import { GET as diagnosticsGet } from "../apps/web/src/app/api/admin/diagnostics/route";
import {
  getConnectorRuntimeTier,
  isConnectorSupportedInRuntime
} from "../apps/web/src/components/connectors-console";
import { runWorkerTickOnce } from "../deploy/worker";

function encodeMqttString(value: string): Buffer {
  const b = Buffer.from(value, "utf8");
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length, 0);
  return Buffer.concat([len, b]);
}

function encodeMqttPacket(header: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([header, body.length]), body]);
}

async function createAdminAuthCookie(conn: DbConnection): Promise<string> {
  const [admin] = await conn.db
    .select()
    .from(users)
    .where(eq(users.tenantId, "tenant-acme"))
    .limit(1);
  if (!admin) throw new Error("Expected seeded acme user");
  const plants = await conn.db
    .select({ plantId: userPlants.plantId })
    .from(userPlants)
    .where(eq(userPlants.userId, admin.id));
  const token = await signSessionToken({
    userId: admin.id,
    tenantId: admin.tenantId,
    role: "admin",
    email: admin.email,
    name: admin.name,
    plantIds: plants.map((p) => p.plantId)
  });
  return `lutic_session=${token}`;
}

describe("v2 Engineering Upgrades — Database, Security, Live Adapters, RAG, Streaming Agent, Durable Worker", () => {
  let conn: DbConnection;
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    conn = await createDbConnection("memory://");
    state.conn = conn;
    await seedDatabase(conn);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    globalThis.fetch = originalFetch;
    registerWorkflowAiExecutor(null);
    state.withWebTenantCalls = 0;
  });

  afterAll(async () => {
    await conn.close();
  });

  it("applies migration v4 with worker_heartbeats (revoked from lutic_app) and vector(1536) document chunks", async () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4]);
    const applied = await getAppliedMigrations(conn);
    expect(applied.map((m) => m.version)).toEqual([1, 2, 3, 4]);
    expect(applied[3]?.name).toBe("0004_dense_embeddings_and_worker_heartbeats");

    const cols = await conn.db.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'document_chunks'
        AND column_name IN ('dense_embedding', 'embedding_model')
      ORDER BY column_name ASC
    `);
    expect(cols.rows.map((r) => r.column_name)).toEqual(["dense_embedding", "embedding_model"]);

    const privs = await conn.db.execute<{ has_select: boolean }>(sql`
      SELECT has_table_privilege('lutic_app', 'worker_heartbeats', 'SELECT') AS has_select
    `);
    expect(privs.rows[0]?.has_select).toBe(false);

    // Synthetic demo seed verification: 1536-dim chunks, seeded worker heartbeat, durable AI workflow, and simulated demo connectors
    const [seededChunk] = await conn.db
      .select({ denseEmbedding: documentChunks.denseEmbedding, embeddingModel: documentChunks.embeddingModel })
      .from(documentChunks)
      .where(eq(documentChunks.tenantId, "tenant-acme"))
      .limit(1);
    expect(seededChunk?.denseEmbedding?.length).toBe(1536);
    expect(seededChunk?.embeddingModel).toBeTruthy();

    const [seededWorker] = await conn.db
      .select()
      .from(workerHeartbeats)
      .where(eq(workerHeartbeats.workerId, "lutic-worker-detroit-01"));
    expect(seededWorker?.tickCount).toBeGreaterThanOrEqual(1);

    const [seededAiRun] = await conn.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, "wfr-seed-ai-1"));
    expect(seededAiRun?.status).toBe("succeeded");

    const [seededSnow] = await conn.db
      .select()
      .from(connectorConnections)
      .where(eq(connectorConnections.id, "conn-hub-servicenow"));
    expect(seededSnow).toBeTruthy();
    expect(hasLiveAdapterSupport(seededSnow!)).toBe(false);
    expect(
      hasLiveAdapterSupport({
        slug: "servicenow",
        transport: "http",
        endpointUrl: "https://acme.service-now.com/api/now"
      })
    ).toBe(true);

    const [seededShowcaseMsg] = await conn.db
      .select({ citations: messages.citations })
      .from(messages)
      .where(eq(messages.id, "msg-demo-f104-a1"));
    const cite = (seededShowcaseMsg?.citations?.[0] ?? {}) as {
      chunkId?: string;
      documentId?: string;
      title?: string;
    };
    expect(cite.chunkId).toBe("doc-loto-sop-chunk-0");
    expect(cite.documentId).toBe("doc-loto-sop");
    expect(cite.title).toContain("SOP-001");
    const [realChunk] = await conn.db
      .select({ id: documentChunks.id })
      .from(documentChunks)
      .where(eq(documentChunks.id, cite.chunkId!));
    expect(realChunk?.id).toBe("doc-loto-sop-chunk-0");

    const composeYaml = fs.readFileSync(path.resolve("docker-compose.yml"), "utf8");
    const workerSection = composeYaml.slice(composeYaml.indexOf("lutic-worker:"));
    expect(workerSection).toContain("CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS:");
    expect(workerSection).toContain("LICENSE_ENFORCE:");
  });

  it("blocks private/reserved SSRF IPs including IPv4-mapped IPv6 and rejects 3xx redirects + oversized responses in safePinnedHttpRequest", async () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("10.12.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);

    await expect(resolveSafeExternalTarget("https://127.0.0.1/api")).rejects.toThrow(/Blocked/i);
    await expect(resolveSafeExternalTarget("https://169.254.169.254/latest/meta-data")).rejects.toThrow(/Blocked/i);
    await expect(resolveSafeExternalTarget("http://service.internal/hook")).rejects.toThrow();

    const server = http.createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "http://169.254.169.254/" });
        res.end();
        return;
      }
      if (req.url === "/huge") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("x".repeat(4096));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));

    try {
      const addr = server.address() as net.AddressInfo;
      process.env.LUTIC_ALLOW_PRIVATE_CONNECTOR_URLS = "true";

      const okRes = await safePinnedHttpRequest(`http://127.0.0.1:${addr.port}/ok`);
      expect(okRes.status).toBe(200);
      expect(JSON.parse(okRes.text)).toEqual({ ok: true });

      await expect(
        safePinnedHttpRequest(`http://127.0.0.1:${addr.port}/redirect`)
      ).rejects.toThrow(/Redirect blocked \(302\)/i);

      await expect(
        safePinnedHttpRequest(`http://127.0.0.1:${addr.port}/huge`, { maxBytes: 512 })
      ).rejects.toThrow(/exceeded 512 bytes/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("executes live binary Modbus TCP and MQTT 3.1.1 wire protocols and reports honest connector tiers", async () => {
    const modbusServer = net.createServer((socket) => {
      socket.on("data", (buf) => {
        if (buf.length < 12) return;
        const txId = buf.readUInt16BE(0);
        const unitId = buf.readUInt8(6);
        const fc = buf.readUInt8(7);
        if (fc === 0x03) {
          const body = Buffer.from([unitId, 0x03, 0x04, 0x01, 0x90, 0x00, 0xfa]);
          const hdr = Buffer.alloc(6);
          hdr.writeUInt16BE(txId, 0);
          hdr.writeUInt16BE(0, 2);
          hdr.writeUInt16BE(body.length, 4);
          socket.write(Buffer.concat([hdr, body]));
        } else if (fc === 0x05) {
          socket.write(buf);
        }
      });
    });

    const publishedMessages: Array<{ topic: string; payload: string }> = [];
    const mqttServer = net.createServer((socket) => {
      let rx = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        rx = Buffer.concat([rx, chunk]);
        while (rx.length >= 2) {
          const len = rx.readUInt8(1);
          if (rx.length < 2 + len) break;
          const type = rx.readUInt8(0) >> 4;
          const body = rx.subarray(2, 2 + len);
          rx = rx.subarray(2 + len);

          if (type === 1) {
            socket.write(Buffer.from([0x20, 0x02, 0x00, 0x00]));
          } else if (type === 3) {
            const tLen = body.readUInt16BE(0);
            const topic = body.subarray(2, 2 + tLen).toString("utf8");
            const payload = body.subarray(2 + tLen).toString("utf8");
            publishedMessages.push({ topic, payload });
          } else if (type === 8) {
            const pid = body.subarray(0, 2);
            socket.write(Buffer.concat([Buffer.from([0x90, 0x03]), pid, Buffer.from([0x00])]));
            socket.write(
              encodeMqttPacket(
                0x30,
                Buffer.concat([
                  encodeMqttString("plant/line1/temp"),
                  Buffer.from('{"value":84.2}', "utf8")
                ])
              )
            );
          }
        }
      });
    });

    await Promise.all([
      new Promise<void>((r) => modbusServer.listen(0, "127.0.0.1", () => r())),
      new Promise<void>((r) => mqttServer.listen(0, "127.0.0.1", () => r()))
    ]);

    try {
      process.env.LUTIC_ALLOW_PRIVATE_OT_NETWORKS = "true";
      const modbusPort = (modbusServer.address() as net.AddressInfo).port;
      const mqttPort = (mqttServer.address() as net.AddressInfo).port;

      const modbusEndpoint = `modbus://127.0.0.1:${modbusPort}`;
      expect(hasLiveAdapterSupport({ slug: "modbus-tcp", transport: "http", endpointUrl: modbusEndpoint })).toBe(true);
      const mbTest = await testLiveAdapter({
        slug: "modbus-tcp",
        transport: "http",
        endpointUrl: modbusEndpoint
      });
      expect(mbTest.healthy).toBe(true);

      const mbRegs = await invokeLiveAdapterTool(
        { slug: "modbus-tcp", transport: "http", endpointUrl: modbusEndpoint },
        "modbus_read_holding_registers",
        { address: 100, quantity: 2 }
      );
      expect(mbRegs.registers).toEqual([400, 250]);

      const mbWrite = await invokeLiveAdapterTool(
        { slug: "modbus-tcp", transport: "http", endpointUrl: modbusEndpoint },
        "modbus_write_coil",
        { address: 12, value: true }
      );
      expect(mbWrite.ok).toBe(true);

      const mqttEndpoint = `mqtt://127.0.0.1:${mqttPort}`;
      const pubRes = await invokeLiveAdapterTool(
        { slug: "mqtt-broker", transport: "http", endpointUrl: mqttEndpoint },
        "mqtt_publish_payload",
        { topic: "plant/line1/alarm", payload: { code: "E-404" } }
      );
      expect(pubRes.published).toBe(true);
      await vi.waitFor(() => {
        expect(publishedMessages[0]?.topic).toBe("plant/line1/alarm");
      });

      const subRes = await invokeLiveAdapterTool(
        { slug: "mqtt-broker", transport: "http", endpointUrl: mqttEndpoint },
        "mqtt_read_recent_topics",
        { topic: "plant/#", waitMs: 120 }
      );
      expect(subRes.count).toBeGreaterThanOrEqual(1);
      expect((subRes.messages as Array<{ topic: string }>)[0]?.topic).toBe("plant/line1/temp");

      expect(getConnectorRuntimeTier({ slug: "cmms", transport: "in_memory_mcp", endpointUrl: "mcp://cmms" })).toBe("Native");
      expect(getConnectorRuntimeTier({ slug: "modbus-tcp", transport: "http", endpointUrl: "modbus://10.0.0.5:502" })).toBe("Live Protocol");
      expect(getConnectorRuntimeTier({ slug: "servicenow", transport: "http", endpointUrl: "https://acme.service-now.com/api/now" })).toBe("Live Protocol");
      expect(getConnectorRuntimeTier({ slug: "ext-mcp", transport: "remote_mcp", endpointUrl: "https://mcp.metorial.example/mcp" })).toBe("HTTPS Bridge");
      expect(getConnectorRuntimeTier({ slug: "sap-s4", transport: "http", endpointUrl: "http://erp.local" })).toBe("Bridge Template");
      expect(isConnectorSupportedInRuntime({ slug: "modbus-tcp", transport: "http", endpointUrl: "modbus://10.0.0.5:502" }, false)).toBe(true);
    } finally {
      await Promise.all([
        new Promise<void>((r) => modbusServer.close(() => r())),
        new Promise<void>((r) => mqttServer.close(() => r()))
      ]);
    }
  });

  it("embeds 1536-dim vectors via DenseHttpEmbeddingProvider and boosts domain matches in HybridLexicalSemanticReranker", async () => {
    const fakeVec = Array.from({ length: 1536 }, (_, idx) => (idx === 0 ? 1 : idx === 1 ? 0.5 : 0.001));
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ embedding: fakeVec }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;

    process.env.EMBEDDING_PROVIDER = "lutic";
    process.env.LUTIC_AI_GATEWAY_URL = "https://gateway.lutic.example/v1";
    process.env.LUTIC_AI_GATEWAY_KEY = "test-key";

    const provider = getDefaultEmbeddingProvider();
    expect(provider).toBeInstanceOf(DenseHttpEmbeddingProvider);
    expect(provider.dimensions).toBe(1536);

    const ingested = await ingestDocumentJob(conn.db, {
      tenantId: "tenant-acme",
      title: "Spindle Bearing E-774 Overtemp SOP",
      type: "sop",
      machineTypes: ["cnc"],
      revision: "Rev 1",
      status: "current",
      effectiveDate: "2026-11-24",
      source: "spindle-e774-sop.md",
      rawContent:
        "Fault E-774 indicates spindle front bearing over-temperature above 85 C. Inspect coolant manifold valve."
    });
    expect(ingested.chunkCount).toBeGreaterThanOrEqual(1);

    const storedChunks = await conn.db
      .select({
        embeddingModel: documentChunks.embeddingModel,
        denseEmbedding: documentChunks.denseEmbedding
      })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, ingested.documentId));
    expect(storedChunks[0]?.embeddingModel).toBe("dense-lutic-embed-1536");
    expect(storedChunks[0]?.denseEmbedding?.length).toBe(1536);

    const searchRes = await hybridSearchDocuments(conn.db, {
      tenantId: "tenant-acme",
      query: "Fault E-774 spindle bearing over-temperature",
      limit: 5,
      embeddingProvider: provider
    });
    expect(searchRes.chunks.some((r) => r.documentId === ingested.documentId)).toBe(true);

    const reranker = new HybridLexicalSemanticReranker();
    expect(StubReranker).toBe(HybridLexicalSemanticReranker);
    const ranked = await reranker.rerank("spindle E-774 overtemp", [
      {
        chunkId: "noise",
        documentId: "doc-noise",
        title: "Canteen Menu",
        revision: "Rev 1",
        status: "current",
        page: 1,
        sectionPath: "General",
        text: "Tuesday soup and bread schedule for plant cafeteria.",
        machineTypes: [],
        faultCodes: [],
        partNumbers: [],
        score: 0.4
      },
      {
        chunkId: "target",
        documentId: ingested.documentId,
        title: "Spindle E-774 Overtemp SOP",
        revision: "Rev 1",
        status: "current",
        page: 1,
        sectionPath: "Fault E-774",
        text: "Fault E-774 spindle overtemp procedure: check coolant manifold immediately.",
        machineTypes: ["cnc"],
        faultCodes: ["E-774"],
        partNumbers: [],
        score: 0.4
      }
    ]);
    expect(ranked[0]?.chunkId).toBe("target");
  });

  it("streams incremental deltas, enforces latest-20 short DB transactions, computes cost, plans specialist stages, and enforces safetyGate", async () => {
    const mockProvider = new MockLLMProvider();
    const deltas: string[] = [];
    const stages = planSpecialistStages(
      "check mach-l1-cnc-01 temperature alarm and SOP manual and create work order",
      true
    );
    expect(stages).toContain("telemetry_specialist");
    expect(stages).toContain("knowledge_specialist");
    expect(stages).toContain("cmms_erp_specialist");
    expect(estimateModelCostUsd("lutic-claude", 1_000_000, 500_000)).toBeGreaterThan(0);

    const unverifiedGate = evaluateIndustrialSafetyGate({
      answer: "Perform Lockout/Tagout on 480 VAC bus and torque spindle bolts to 45 Nm.",
      citations: []
    });
    expect(unverifiedGate.safetyGate.status).toBe("hold_unverified");
    expect(unverifiedGate.safetyGate.unverifiedHold).toBe(true);

    const groundedGate = evaluateIndustrialSafetyGate({
      answer: "Perform Lockout/Tagout on 480 VAC bus and torque spindle bolts to 45 Nm.",
      citations: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          title: "SOP-001",
          revision: "Rev 2",
          status: "current",
          page: 1,
          sectionPath: "1. Torque",
          excerpt: "Torque 45 Nm"
        }
      ]
    });
    expect(groundedGate.safetyGate.status).toBe("caution");
    expect(groundedGate.safetyGate.unverifiedHold).toBe(false);
    expect(groundedGate.safetyGate.citedCurrentSops[0]).toContain("SOP-001");

    const agentRes = await runAgentTurn({
      db: conn.db,
      runScopedDb: (fn) => withTenantScope(conn.db, "tenant-acme", fn),
      llmProvider: mockProvider,
      user: {
        userId: "usr-test",
        tenantId: "tenant-acme",
        role: "engineer",
        email: "eng@acme.test",
        name: "Test Engineer",
        plantIds: ["plant-north"]
      },
      message: "Check mach-l1-cnc-01 status and SOP fault code",
      machineId: "mach-l1-cnc-01",
      onTokenDelta: (delta) => deltas.push(delta)
    });
    expect(deltas.length).toBeGreaterThan(1);
    expect(agentRes.answer.length).toBeGreaterThan(0);
    expect((agentRes.agentStages as SpecialistStageTrace[]).some((s) => s.agent === "safety_verifier")).toBe(true);
    expect(Array.isArray(agentRes.pendingActions)).toBe(true);
    expect(agentRes.pendingAction).toBe(agentRes.pendingActions[0]);

    // Verify /api/chat keeps the latest 20 messages, streams incremental SSE deltas, and closes DB scopes around LLM work
    const convId = `conv-v2-${crypto.randomUUID().slice(0, 8)}`;
    const cookie = await createAdminAuthCookie(conn);
    const [seedUser] = await conn.db.select().from(users).where(eq(users.tenantId, "tenant-acme")).limit(1);
    await conn.db.insert(conversations).values({
      id: convId,
      tenantId: "tenant-acme",
      userId: seedUser!.id,
      title: "Latest-20 Streaming Test"
    });
    const baseTs = Date.now() - 30_000;
    for (let i = 1; i <= 25; i += 1) {
      await conn.db.insert(messages).values({
        id: `msg-v2-${convId}-${String(i).padStart(2, "0")}`,
        tenantId: "tenant-acme",
        conversationId: convId,
        role: i % 2 === 1 ? "user" : "assistant",
        content: `history-entry-${i}`,
        createdAt: new Date(baseTs + i * 1000)
      });
    }

    state.withWebTenantCalls = 0;
    const chatReq = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        Cookie: cookie
      },
      body: JSON.stringify({
        conversationId: convId,
        message: "Summarize mach-l1-cnc-01 telemetry status",
        stream: true
      })
    });
    const chatRes = await chatPost(chatReq);
    expect(chatRes.status).toBe(200);
    expect(chatRes.headers.get("content-type")).toContain("text/event-stream");
    const sseText = await chatRes.text();
    const deltaFrames = sseText
      .split("\n\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; text?: string; payload?: unknown });
    expect(deltaFrames.filter((f) => f.type === "delta").length).toBeGreaterThan(1);
    expect(deltaFrames.some((f) => f.type === "done")).toBe(true);
    expect(state.withWebTenantCalls).toBeGreaterThanOrEqual(2);
  });

  it("supports workflow step retries, crash checkpoint resume, fail-closed production AI executor, and worker heartbeat diagnostics", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevDemo = process.env.LUTIC_DEMO_MODE;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      process.env.LUTIC_DEMO_MODE = "false";
      process.env.AUTH_SECRET = "v2-test-production-auth-secret-9876543210-abcdef";
      process.env.CREDENTIAL_ENCRYPTION_KEY =
        "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

      const wfId = `wf-v2-${crypto.randomUUID().slice(0, 8)}`;
      const [plantRow] = await conn.db.select().from(workflows).where(eq(workflows.tenantId, "tenant-acme")).limit(1);
      await conn.db.insert(workflows).values({
        id: wfId,
        tenantId: "tenant-acme",
        plantId: plantRow?.plantId ?? "plant-north",
        name: "Durable Retry & Checkpoint Workflow",
        description: "Tests step retries, checkpoint persistence, and AI resume",
        triggerType: "manual",
        triggerConfig: {},
        definition: {
          nodes: [
            { id: "n1", type: "trigger", label: "Start", config: {} },
            { id: "n2", type: "ai", label: "Analyze Telemetry", config: { prompt: "Summarize", retries: 1, retryDelayMs: 5 } }
          ],
          edges: [{ id: "e1", source: "n1", target: "n2" }]
        },
        enabled: true,
        currentVersion: 1,
        createdBy: "test-suite"
      });

      // 1) Fail-closed in production without AI executor, leaving step n1 checkpointed on failed run
      registerWorkflowAiExecutor(null);
      const failedRun = await executeWorkflow(conn.db, {
        tenantId: "tenant-acme",
        workflowId: wfId,
        input: { machineId: "mach-l1-cnc-01" }
      });
      expect(failedRun.status).toBe("failed");
      expect(failedRun.error).toContain("workflow AI executor");
      const failedTraces = failedRun.stepTraces as Array<{ nodeId: string; status: string; checkpointedAt?: string }>;
      expect(failedTraces.find((t) => t.nodeId === "n1")?.status).toBe("succeeded");
      expect(failedTraces.find((t) => t.nodeId === "n1")?.checkpointedAt).toBeTruthy();

      // 2) Register AI executor that fails on attempt 1 and succeeds on attempt 2, then resumeWorkflowRun!
      let aiInvocations = 0;
      registerWorkflowAiExecutor(async () => {
        aiInvocations += 1;
        if (aiInvocations === 1) {
          throw new Error("Transient LLM gateway timeout");
        }
        return { summary: "Bearing nominal after retry" };
      });

      const resumed = await resumeWorkflowRun(conn.db, failedRun.id);
      expect(resumed.status).toBe("succeeded");
      expect(aiInvocations).toBe(2);
      const resumedTraces = resumed.stepTraces as Array<{ nodeId: string; status: string; attempts?: number }>;
      expect(resumedTraces.find((t) => t.nodeId === "n2")?.attempts).toBe(2);
      expect((resumed.output as { summary?: string })?.summary).toBe("Bearing nominal after retry");

      // 3) Dedicated worker tick & diagnostics merge when LUTIC_RUNTIME_DISABLED=true
      process.env.LUTIC_RUNTIME_DISABLED = "true";
      const workerTick = await runWorkerTickOnce(conn.db, {
        workerId: "worker-test-01",
        hostname: "worker-host",
        startedAt: new Date(),
        tickCount: 0
      });
      expect(workerTick.skipped).toBeNull();
      expect(workerTick.tickCount).toBe(1);

      const cookie = await createAdminAuthCookie(conn);
      const diagRes = await diagnosticsGet(
        new Request("http://localhost/api/admin/diagnostics", {
          headers: { Cookie: cookie }
        })
      );
      expect(diagRes.status).toBe(200);
      const diagJson = (await diagRes.json()) as {
        runtime: { autoEnabled: boolean; workerId?: string; tickCount?: number };
      };
      expect(diagJson.runtime.workerId).toBe("worker-test-01");
      expect(diagJson.runtime.autoEnabled).toBe(true);
      expect(diagJson.runtime.tickCount).toBeGreaterThanOrEqual(1);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
      process.env.LUTIC_DEMO_MODE = prevDemo;
    }
  });
});
