import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createDbConnection,
  DEMO_PASSWORD,
  getConnectorAuthBlueprint,
  resetGlobalDbForTests,
  seedDatabase,
  type DbConnection
} from "@lutic/core";
import { POST as loginPost } from "../apps/web/src/app/api/auth/login/route";
import { GET as connectorsGet, POST as connectorsPost } from "../apps/web/src/app/api/connectors/route";
import { POST as testPost } from "../apps/web/src/app/api/connectors/[id]/test/route";
import { POST as invokePost } from "../apps/web/src/app/api/connectors/[id]/invoke/route";
import { POST as oauthAuthorizePost } from "../apps/web/src/app/api/connectors/oauth/authorize/route";
import { GET as oauthCallbackGet } from "../apps/web/src/app/api/connectors/oauth/callback/route";

describe("Composio / MCP / OpenAPI Auth Blueprints & OAuth 2.0 + PKCE Live Flows", () => {
  let conn: DbConnection;

  beforeAll(async () => {
    resetGlobalDbForTests();
    vi.stubEnv("LICENSE_ENFORCE", "false");
    vi.stubEnv("LUTIC_DEMO_MODE", "true");
    conn = await createDbConnection("memory://");
    await seedDatabase(conn);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("LICENSE_ENFORCE", "false");
    vi.stubEnv("LUTIC_DEMO_MODE", "true");
  });

  afterAll(async () => {
    await conn?.close();
    resetGlobalDbForTests();
  });

  it("derives exact per-integration auth blueprints cleanly", () => {
    const gh = getConnectorAuthBlueprint({ slug: "github", name: "GitHub" });
    expect(gh.defaultScheme).toBe("oauth2");
    expect(gh.supportedSchemes).toEqual(["oauth2", "bearer", "api_key"]);
    expect(gh.defaultEndpointUrl).toBe("https://api.github.com");

    const cloud = getConnectorAuthBlueprint({
      slug: "lutic-cloud",
      name: "Lutic Cloud Connectors",
      transport: "remote_mcp"
    });
    expect(cloud.defaultScheme).toBe("remote_mcp");
    expect(cloud.supportedSchemes).toContain("remote_mcp");

    const spec = getConnectorAuthBlueprint({
      slug: "lutic-api",
      name: "Lutic Direct API",
      transport: "utcp_http"
    });
    expect(spec.defaultScheme).toBe("openapi");
    expect(spec.fieldsByScheme.openapi?.[0]?.label).toContain("OpenAPI");

    const mb = getConnectorAuthBlueprint({ slug: "modbus-tcp", name: "Modbus TCP" });
    expect(mb.defaultScheme).toBe("protocol");
    expect(mb.fieldsByScheme.protocol?.some((f) => f.key === "unitId")).toBe(true);
  });

  it("completes OAuth 2.0 + PKCE authorization, token vaulting, and live API invocation end-to-end", async () => {
    vi.stubEnv("LUTIC_ALLOW_PRIVATE_CONNECTOR_URLS", "true");
    vi.stubEnv("LUTIC_DEMO_MODE", "false");

    let seenTokenExchangeBody = "";
    let seenBearerHeader = "";
    let seenCustomKeyHeader = "";

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (req.method === "POST" && reqUrl.pathname === "/oauth/token") {
          seenTokenExchangeBody = Buffer.concat(chunks).toString("utf8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              access_token: "gho_live_secret_token_999",
              refresh_token: "ghr_refresh_token_111",
              token_type: "Bearer",
              expires_in: 3600,
              scope: "repo read:user"
            })
          );
          return;
        }
        if (reqUrl.pathname === "/user" || reqUrl.pathname === "/user/repos") {
          seenBearerHeader = String(req.headers["authorization"] || "");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ repos: [{ id: 1, name: "lutic-agent-core" }] }));
          return;
        }
        if (reqUrl.pathname === "/probe") {
          seenCustomKeyHeader = String(req.headers["x-vendor-key"] || "");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ healthy: true, customKeySeen: Boolean(seenCustomKeyHeader) }));
          return;
        }
        res.writeHead(404);
        res.end("not found");
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const loginRes = await loginPost(
        new Request("http://localhost:3000/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "admin@acme.demo", password: DEMO_PASSWORD })
        })
      );
      expect(loginRes.status).toBe(200);
      const { token } = (await loginRes.json()) as { token: string };

      // 1. Start OAuth 2.0 + PKCE authorize handshake
      const authRes = await oauthAuthorizePost(
        new Request("http://localhost:3000/api/connectors/oauth/authorize", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            slug: "github",
            name: "Lutic GitHub Workspace",
            endpointUrl: baseUrl,
            authorizationUrl: `${baseUrl}/oauth/authorize`,
            tokenUrl: `${baseUrl}/oauth/token`,
            clientId: "cid_test_123",
            clientSecret: "csec_test_456"
          })
        })
      );
      expect(authRes.status).toBe(200);
      const authBody = (await authRes.json()) as { authorizationUrl: string };
      const authUrl = new URL(authBody.authorizationUrl);
      expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
      const state = authUrl.searchParams.get("state")!;
      const oauthCookie = (authRes.headers.get("set-cookie") ?? "").split(";")[0]!;
      expect(oauthCookie).toContain("lutic_connector_oauth=");

      // 2. Provider redirects back to /api/connectors/oauth/callback with code & state
      const cbRes = await oauthCallbackGet(
        new Request(
          `http://localhost:3000/api/connectors/oauth/callback?code=auth_code_777&state=${encodeURIComponent(state)}`,
          {
            headers: {
              authorization: `Bearer ${token}`,
              cookie: oauthCookie
            }
          }
        )
      );
      expect(cbRes.status).toBe(307);
      expect(cbRes.headers.get("location")).toContain("/connectors?connected=");
      expect(seenTokenExchangeBody).toContain("code=auth_code_777");
      expect(seenTokenExchangeBody).toContain("code_verifier=");

      // 3. Connected Account appears sanitized (no tokens returned!) & invokes live endpoint via vault
      const listRes = await connectorsGet(
        new Request("http://localhost:3000/api/connectors", {
          headers: { authorization: `Bearer ${token}` }
        })
      );
      const listJson = (await listRes.json()) as {
        connectors: Array<{ id: string; name: string; transport: string; hasCredentials: boolean }>;
      };
      const ghConn = listJson.connectors.find((c) => c.name === "Lutic GitHub Workspace")!;
      expect(ghConn).toBeDefined();
      expect(ghConn.transport).toBe("http");
      expect(ghConn.hasCredentials).toBe(true);
      expect(JSON.stringify(ghConn)).not.toContain("gho_live_secret_token_999");

      const invRes = await invokePost(
        new Request(`http://localhost:3000/api/connectors/${ghConn.id}/invoke`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ toolName: "list_repos", args: {} })
        }),
        { params: Promise.resolve({ id: ghConn.id }) }
      );
      expect(invRes.status).toBe(200);
      expect(seenBearerHeader).toBe("Bearer gho_live_secret_token_999");

      // 4. Direct API Key with custom header connects live even in production mode
      const apiKeyCreate = await connectorsPost(
        new Request("http://localhost:3000/api/connectors", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            name: "Vendor REST Probe",
            kind: "17track",
            authScheme: "api_key",
            endpointUrl: `${baseUrl}/probe`,
            credentials: {
              apiKey: "vendor_secret_888",
              headerName: "x-vendor-key"
            }
          })
        })
      );
      expect(apiKeyCreate.status).toBe(201);
      const createdApiKey = (await apiKeyCreate.json()) as {
        id: string;
        connector: { transport: string };
      };
      expect(createdApiKey.connector.transport).toBe("http");

      const probeTest = await testPost(
        new Request(`http://localhost:3000/api/connectors/${createdApiKey.id}/test`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({})
        }),
        { params: Promise.resolve({ id: createdApiKey.id }) }
      );
      expect(probeTest.status).toBe(200);
      expect(seenCustomKeyHeader).toBe("vendor_secret_888");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
