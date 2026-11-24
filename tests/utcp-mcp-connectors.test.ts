import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertSafeExternalUrl, ensureSchema, getDbConnection } from "@lutic/core";
import { bootstrapDatabase } from "../packages/core/src/db/bootstrap";
import { POST as loginPost } from "../apps/web/src/app/api/auth/login/route";
import { POST as connectorsPost } from "../apps/web/src/app/api/connectors/route";
import { POST as syncPost } from "../apps/web/src/app/api/connectors/[id]/sync/route";
import { POST as invokePost } from "../apps/web/src/app/api/connectors/[id]/invoke/route";
import { GET as utcpManualGet } from "../apps/web/src/app/api/connectors/utcp/route";

const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
const TEST_AUTH_SECRET = crypto.randomBytes(32).toString("hex");
const ADMIN_EMAIL = "ops-admin@utcp-test.example";
const ADMIN_PASSWORD = "a7f9c2e14b608d3f9a1c5e7b2d4f6a80";

let server: http.Server;
let targetServer: http.Server;
let baseUrl: string;
let targetBaseUrl: string;
let authHeader: string;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "memory://");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_SECRET", TEST_AUTH_SECRET);
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  vi.stubEnv("LICENSE_ENFORCE", "false");
  vi.stubEnv("LUTIC_RUNTIME_DISABLED", "true");

  targetServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/orders/ORD-X/hold") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          held: true,
          authSeen: Boolean(req.headers.authorization),
          apiKeySeen: Boolean(req.headers["x-api-key"]),
          customCredentialSeen: Boolean(req.headers["x-connector-secret"])
        })
      );
      return;
    }
    res.statusCode = 404;
    res.end("Not Found");
  });
  await new Promise<void>((resolve) => targetServer.listen(0, "127.0.0.1", () => resolve()));
  const targetAddr = targetServer.address() as AddressInfo;
  targetBaseUrl = `http://127.0.0.1:${targetAddr.port}`;

  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (req.method === "POST" && url === "/mcp") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const payload = JSON.parse(body || "{}") as {
          id?: number | string;
          method?: string;
          params?: { name?: string; arguments?: Record<string, unknown> };
        };
        res.setHeader("Content-Type", "application/json");
        if (payload.method === "initialize") {
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: payload.id ?? 1,
              result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } }
            })
          );
          return;
        }
        if (payload.method === "tools/list") {
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: payload.id ?? 1,
              result: {
                tools: [
                  {
                    name: "metorial_get_shift_notes",
                    description: "Fetch remote plant shift handoff notes",
                    inputSchema: { type: "object", properties: { line: { type: "string" } } }
                  }
                ]
              }
            })
          );
          return;
        }
        if (payload.method === "tools/call") {
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: payload.id ?? 1,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      source: "metorial-mock",
                      authSeen: Boolean(req.headers.authorization),
                      line: payload.params?.arguments?.line ?? "unknown"
                    })
                  }
                ]
              }
            })
          );
          return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Unsupported RPC method" }));
      });
      return;
    }

    if (req.method === "GET" && url === "/utcp.json") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          manual_version: "1.0.0",
          utcp_version: "1.0.0",
          tools: [
            {
              name: "place_order_hold",
              description: "Place a production order on hold via UTCP HTTP template",
              tool_call_template: {
                call_template_type: "http",
                url: `${baseUrl}/api/orders/{orderId}/hold`,
                http_method: "POST"
              }
            }
          ]
        })
      );
      return;
    }

    if (req.method === "GET" && url === "/cross-origin-utcp.json") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          tools: [
            {
              name: "cross_origin_hold",
              tool_call_template: {
                url: `${targetBaseUrl}/api/orders/{orderId}/hold`,
                http_method: "POST"
              }
            }
          ]
        })
      );
      return;
    }

    if (req.method === "POST" && url.startsWith("/api/orders/") && url.endsWith("/hold")) {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const orderId = url.split("/")[3] ?? "";
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            held: true,
            orderId,
            body: body ? JSON.parse(body) : {},
            authSeen: Boolean(req.headers.authorization)
          })
        );
      });
      return;
    }

    res.statusCode = 404;
    res.end("Not Found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  const conn = await getDbConnection();
  await ensureSchema(conn);
  await bootstrapDatabase(conn, {
    LUTIC_TENANT_NAME: "UTCP Tenant",
    LUTIC_PLANT_NAME: "UTCP Plant",
    LUTIC_ADMIN_EMAIL: ADMIN_EMAIL,
    LUTIC_ADMIN_PASSWORD: ADMIN_PASSWORD
  });

  const loginRes = await loginPost(
    new Request("https://lutic.example/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    })
  );
  expect(loginRes.status).toBe(200);
  const session = await loginRes.json();
  authHeader = `Bearer ${session.token}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => targetServer.close(() => resolve()));
  const conn = await getDbConnection();
  await conn.close();
  vi.unstubAllEnvs();
});

describe("UTCP & Remote MCP Connectors (Metorial / OpenConnectors)", () => {
  it("blocks private, loopback, metadata, and non-HTTPS URLs while allowing public HTTPS IPs", async () => {
    vi.stubEnv("LUTIC_ALLOW_PRIVATE_CONNECTOR_URLS", "false");
    await expect(assertSafeExternalUrl("http://127.0.0.1:4000/mcp")).rejects.toThrow(/HTTPS/i);
    await expect(assertSafeExternalUrl("https://localhost/mcp")).rejects.toThrow(/internal hostname/i);
    await expect(assertSafeExternalUrl("https://169.254.169.254/latest")).rejects.toThrow(/private or reserved/i);
    await expect(assertSafeExternalUrl("https://10.0.0.5/api")).rejects.toThrow(/private or reserved/i);
    await expect(assertSafeExternalUrl("https://93.184.216.34/mcp")).resolves.toMatchObject({
      protocol: "https:",
      hostname: "93.184.216.34"
    });
  });

  it("exports Lutic's UTCP 1.0 manual for the authenticated tenant", async () => {
    const res = await utcpManualGet(
      new Request("https://lutic.example/api/connectors/utcp", {
        headers: { Authorization: authHeader }
      })
    );
    expect(res.status).toBe(200);
    const manual = await res.json();
    expect(manual.manual_version).toBe("1.0.0");
    expect(manual.utcp_version).toBe("1.0.0");
    expect(Array.isArray(manual.tools)).toBe(true);
    expect(manual.tools.length).toBeGreaterThan(0);
  });

  it("registers, syncs, and invokes Remote MCP (Metorial) and UTCP HTTP connectors end-to-end", async () => {
    vi.stubEnv("LUTIC_ALLOW_PRIVATE_CONNECTOR_URLS", "true");

    // 1. Remote MCP (Metorial)
    const createMcpRes = await connectorsPost(
      new Request("https://lutic.example/api/connectors", {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Metorial Handoff",
          kind: "metorial",
          endpointUrl: `${baseUrl}/mcp`,
          credentials: { token: "metorial-secret-token" }
        })
      })
    );
    expect(createMcpRes.status).toBe(201);
    const { connector: mcpConn } = await createMcpRes.json();
    expect(mcpConn.transport).toBe("remote_mcp");

    const syncMcpRes = await syncPost(
      new Request(`https://lutic.example/api/connectors/${mcpConn.id}/sync`, {
        method: "POST",
        headers: { Authorization: authHeader }
      }),
      { params: Promise.resolve({ id: mcpConn.id }) }
    );
    expect(syncMcpRes.status).toBe(200);
    const syncMcpData = await syncMcpRes.json();
    expect(syncMcpData.tools.length).toBe(1);

    const invokeMcpRes = await invokePost(
      new Request(`https://lutic.example/api/connectors/${mcpConn.id}/invoke`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          toolName: "metorial_get_shift_notes",
          args: { line: "Line-3" }
        })
      }),
      { params: Promise.resolve({ id: mcpConn.id }) }
    );
    expect(invokeMcpRes.status).toBe(200);
    const invokeMcpData = await invokeMcpRes.json();
    expect(invokeMcpData.result).toMatchObject({
      source: "metorial-mock",
      authSeen: true,
      line: "Line-3"
    });

    // 2. UTCP HTTP
    const createUtcpRes = await connectorsPost(
      new Request("https://lutic.example/api/connectors", {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "ERP Hold API",
          kind: "utcp-http",
          endpointUrl: `${baseUrl}/utcp.json`,
          credentials: { token: "utcp-secret-token" }
        })
      })
    );
    expect(createUtcpRes.status).toBe(201);
    const { connector: utcpConn } = await createUtcpRes.json();
    expect(utcpConn.transport).toBe("utcp_http");

    const syncUtcpRes = await syncPost(
      new Request(`https://lutic.example/api/connectors/${utcpConn.id}/sync`, {
        method: "POST",
        headers: { Authorization: authHeader }
      }),
      { params: Promise.resolve({ id: utcpConn.id }) }
    );
    expect(syncUtcpRes.status).toBe(200);
    expect((await syncUtcpRes.json()).tools.length).toBe(1);

    const invokeUtcpRes = await invokePost(
      new Request(`https://lutic.example/api/connectors/${utcpConn.id}/invoke`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          toolName: "place_order_hold",
          args: { orderId: "ORD-904", reason: "bearing_vibration" }
        })
      }),
      { params: Promise.resolve({ id: utcpConn.id }) }
    );
    expect(invokeUtcpRes.status).toBe(200);
    const invokeUtcpData = await invokeUtcpRes.json();
    expect(invokeUtcpData.result).toMatchObject({
      held: true,
      orderId: "ORD-904",
      authSeen: true,
      body: { reason: "bearing_vibration" }
    });
  });

  it("does not forward connector credentials to a persisted cross-origin UTCP target", async () => {
    vi.stubEnv("LUTIC_ALLOW_PRIVATE_CONNECTOR_URLS", "true");
    const createRes = await connectorsPost(
      new Request("https://lutic.example/api/connectors", {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Cross-origin ERP API",
          kind: "utcp-http",
          endpointUrl: `${baseUrl}/cross-origin-utcp.json`,
          credentials: {
            token: "must-not-leak",
            apiKey: "must-not-leak",
            headers: { "x-connector-secret": "must-not-leak" }
          }
        })
      })
    );
    expect(createRes.status).toBe(201);
    const { connector } = await createRes.json();

    const syncRes = await syncPost(
      new Request(`https://lutic.example/api/connectors/${connector.id}/sync`, {
        method: "POST",
        headers: { Authorization: authHeader }
      }),
      { params: Promise.resolve({ id: connector.id }) }
    );
    expect(syncRes.status).toBe(200);
    expect((await syncRes.json()).tools[0].callTemplate.url).toBe(
      `${targetBaseUrl}/api/orders/%7BorderId%7D/hold`
    );

    const invokeRes = await invokePost(
      new Request(`https://lutic.example/api/connectors/${connector.id}/invoke`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ toolName: "cross_origin_hold", args: { orderId: "ORD-X" } })
      }),
      { params: Promise.resolve({ id: connector.id }) }
    );
    expect(invokeRes.status).toBe(200);
    expect((await invokeRes.json()).result).toMatchObject({
      held: true,
      authSeen: false,
      apiKeySeen: false,
      customCredentialSeen: false
    });
  });
});
