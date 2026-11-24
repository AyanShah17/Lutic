import dns from "node:dns";
import net from "node:net";

const MAX_EXTERNAL_BODY_BYTES = 1024 * 1024;
const EXTERNAL_TIMEOUT_MS = 15_000;

export interface ExternalConnectorTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  callTemplate?: {
    url: string;
    method: string;
    headers?: Record<string, string>;
  };
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateOrReservedIp(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (net.isIPv4(ip)) return isPrivateOrReservedIpv4(ip);
  if (!net.isIPv6(ip)) return true;
  if (ip === "::" || ip === "::1") return true;
  if (ip.startsWith("::ffff:")) {
    const v4 = ip.slice("::ffff:".length);
    if (net.isIPv4(v4)) return isPrivateOrReservedIpv4(v4);
  }
  const firstHextet = Number.parseInt(ip.split(":")[0] || "0", 16);
  if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/**
 * Validates that an external connector URL uses HTTPS (or HTTP only when explicitly opted-in for
 * isolated local tests via KOJO_ALLOW_PRIVATE_CONNECTOR_URLS=true) and resolves solely to public IPs.
 */
export async function assertSafeExternalUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Invalid connector endpoint URL.");
  }

  const allowPrivate = process.env.KOJO_ALLOW_PRIVATE_CONNECTOR_URLS === "true";
  const allowedProtocols = allowPrivate ? ["https:", "http:"] : ["https:"];
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(
      `Unsafe connector protocol '${parsed.protocol}'. Only HTTPS endpoints are permitted.`
    );
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) {
    throw new Error("Connector URL must include a hostname.");
  }

  if (!allowPrivate) {
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      throw new Error(`Blocked internal hostname '${hostname}' for external connector.`);
    }

    if (net.isIP(hostname) !== 0) {
      if (isPrivateOrReservedIp(hostname)) {
        throw new Error(`Blocked private or reserved IP address '${hostname}'.`);
      }
      return parsed;
    }

    let resolved: Array<{ address: string }>;
    try {
      resolved = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new Error(`Unable to resolve external connector host '${hostname}'.`);
    }
    if (resolved.length === 0) {
      throw new Error(`No DNS records found for '${hostname}'.`);
    }
    for (const rec of resolved) {
      if (isPrivateOrReservedIp(rec.address)) {
        throw new Error(
          `Blocked private or reserved destination IP (${rec.address}) for host '${hostname}'.`
        );
      }
    }
  }

  return parsed;
}

export function buildAuthHeaders(creds?: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!creds) return headers;

  const bearer =
    (typeof creds.token === "string" && creds.token.trim()) ||
    (typeof creds.accessToken === "string" && creds.accessToken.trim()) ||
    (typeof creds.apiKey === "string" && creds.apiKey.trim()) ||
    (typeof creds.secret === "string" && creds.secret.trim()) ||
    "";

  if (bearer) {
    headers["Authorization"] = `Bearer ${bearer}`;
  }
  if (typeof creds.apiKey === "string" && creds.apiKey.trim()) {
    headers["x-api-key"] = creds.apiKey.trim();
  }
  if (creds.headers && typeof creds.headers === "object" && !Array.isArray(creds.headers)) {
    for (const [k, v] of Object.entries(creds.headers as Record<string, unknown>)) {
      if (typeof v === "string" && /^[a-zA-Z0-9-]+$/.test(k)) {
        headers[k] = v;
      }
    }
  }
  return headers;
}

async function readBoundedText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_EXTERNAL_BODY_BYTES) {
        throw new Error(`External connector response exceeded ${MAX_EXTERNAL_BODY_BYTES} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

function parseMcpResponseBody(rawText: string, contentType: string): Record<string, unknown> {
  if (contentType.includes("text/event-stream")) {
    const dataLines = rawText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]");
    for (let i = dataLines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(dataLines[i]!) as Record<string, unknown>;
        if ("result" in parsed || "error" in parsed) return parsed;
      } catch {
        // Skip non-JSON SSE frames
      }
    }
    throw new Error("Remote MCP server returned an SSE stream without a JSON-RPC payload.");
  }
  return JSON.parse(rawText) as Record<string, unknown>;
}

async function mcpJsonRpc(
  endpointUrl: string,
  method: string,
  params: Record<string, unknown>,
  creds?: Record<string, unknown>,
  sessionId?: string
): Promise<{ result: Record<string, unknown>; sessionId?: string }> {
  const safeUrl = await assertSafeExternalUrl(endpointUrl);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...buildAuthHeaders(creds)
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  const res = await fetch(safeUrl.href, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `kojo-${Date.now()}`,
      method,
      params
    }),
    redirect: "error",
    signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS)
  });

  const text = await readBoundedText(res);
  if (!res.ok) {
    throw new Error(`Remote MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const payload = parseMcpResponseBody(text, res.headers.get("content-type") ?? "");
  if (payload.error && typeof payload.error === "object") {
    const errMsg = String((payload.error as { message?: unknown }).message ?? "Remote MCP error");
    throw new Error(errMsg);
  }
  const returnedSessionId = res.headers.get("mcp-session-id") ?? sessionId;
  return {
    result: (payload.result as Record<string, unknown>) ?? {},
    sessionId: returnedSessionId
  };
}

/**
 * Discovers tools from any Streamable HTTP MCP server (Metorial Magic MCP, OpenConnectors, or UTCP-MCP).
 */
export async function discoverRemoteMcpTools(
  endpointUrl: string,
  creds?: Record<string, unknown>
): Promise<ExternalConnectorTool[]> {
  const init = await mcpJsonRpc(
    endpointUrl,
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "kojo", version: "0.1.0" }
    },
    creds
  );

  const listRes = await mcpJsonRpc(endpointUrl, "tools/list", {}, creds, init.sessionId);
  const rawTools = Array.isArray(listRes.result.tools)
    ? (listRes.result.tools as Array<Record<string, unknown>>)
    : [];

  return rawTools
    .filter((t) => typeof t.name === "string" && t.name.trim().length > 0)
    .map((t) => ({
      name: String(t.name),
      description: typeof t.description === "string" ? t.description : undefined,
      inputSchema:
        t.inputSchema && typeof t.inputSchema === "object"
          ? (t.inputSchema as Record<string, unknown>)
          : undefined
    }));
}

/**
 * Invokes a tool on a Streamable HTTP MCP server (Metorial, OpenConnectors, or UTCP-MCP).
 */
export async function callRemoteMcpTool(
  endpointUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  creds?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const init = await mcpJsonRpc(
    endpointUrl,
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "kojo", version: "0.1.0" }
    },
    creds
  );

  const callRes = await mcpJsonRpc(
    endpointUrl,
    "tools/call",
    { name: toolName, arguments: args },
    creds,
    init.sessionId
  );

  const content = Array.isArray(callRes.result.content)
    ? (callRes.result.content as Array<Record<string, unknown>>)
    : [];
  const textItem = content.find((c) => c.type === "text" && typeof c.text === "string");
  if (callRes.result.isError) {
    throw new Error(String(textItem?.text ?? `Remote MCP tool '${toolName}' failed.`));
  }
  if (textItem && typeof textItem.text === "string") {
    try {
      const parsed = JSON.parse(textItem.text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { value: parsed };
    } catch {
      return { text: textItem.text, content };
    }
  }
  return callRes.result;
}

/**
 * Discovers tools from a UTCP 1.0 JSON manual or an OpenAPI 3.x specification URL.
 */
export async function discoverUtcpTools(
  endpointUrl: string,
  creds?: Record<string, unknown>
): Promise<ExternalConnectorTool[]> {
  const safeUrl = await assertSafeExternalUrl(endpointUrl);
  const res = await fetch(safeUrl.href, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...buildAuthHeaders(creds)
    },
    redirect: "error",
    signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS)
  });

  const text = await readBoundedText(res);
  if (!res.ok) {
    throw new Error(`UTCP/OpenAPI manual fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const doc = JSON.parse(text) as Record<string, unknown>;

  // UTCP 1.0 JSON manual format
  if (Array.isArray(doc.tools)) {
    return (doc.tools as Array<Record<string, unknown>>)
      .filter((t) => typeof t.name === "string" && t.name.trim().length > 0)
      .map((t) => {
        const tpl = (t.tool_call_template ?? t.callTemplate ?? {}) as Record<string, unknown>;
        const targetRaw = String(tpl.url ?? endpointUrl);
        const resolvedUrl = new URL(targetRaw, safeUrl.href).href;
        const tplHeaders =
          tpl.headers && typeof tpl.headers === "object" && !Array.isArray(tpl.headers)
            ? Object.fromEntries(
                Object.entries(tpl.headers as Record<string, unknown>).map(([k, v]) => [
                  k,
                  String(v)
                ])
              )
            : undefined;
        return {
          name: String(t.name),
          description: typeof t.description === "string" ? t.description : undefined,
          inputSchema: (t.inputs ?? t.inputSchema) as Record<string, unknown> | undefined,
          callTemplate: {
            url: resolvedUrl,
            method: String(tpl.http_method ?? tpl.method ?? "POST").toUpperCase(),
            ...(tplHeaders ? { headers: tplHeaders } : {})
          }
        };
      });
  }

  // OpenAPI 3.x JSON spec format
  if (doc.paths && typeof doc.paths === "object") {
    const servers = Array.isArray(doc.servers)
      ? (doc.servers as Array<{ url?: string }>)
      : [];
    const baseHref = servers[0]?.url
      ? new URL(servers[0].url, safeUrl.origin).href.replace(/\/$/, "")
      : safeUrl.origin;

    const out: ExternalConnectorTool[] = [];
    for (const [routePath, methodsObj] of Object.entries(
      doc.paths as Record<string, Record<string, unknown>>
    )) {
      if (!methodsObj || typeof methodsObj !== "object") continue;
      for (const method of ["get", "post", "put", "patch", "delete"]) {
        const op = methodsObj[method] as Record<string, unknown> | undefined;
        if (!op) continue;
        const fallbackName = `${method}_${routePath}`
          .replace(/[^a-zA-Z0-9_]+/g, "_")
          .replace(/^_|_$/g, "");
        const name = String(op.operationId ?? fallbackName).replace(/[^a-zA-Z0-9_.-]/g, "_");
        const properties: Record<string, unknown> = {};
        const required: string[] = [];

        if (Array.isArray(op.parameters)) {
          for (const param of op.parameters as Array<Record<string, unknown>>) {
            if (typeof param.name === "string") {
              properties[param.name] =
                (param.schema as Record<string, unknown>) ?? { type: "string" };
              if (param.required === true) required.push(param.name);
            }
          }
        }
        const reqBody = op.requestBody as
          | { content?: { "application/json"?: { schema?: { properties?: Record<string, unknown>; required?: string[] } } } }
          | undefined;
        const jsonSchema = reqBody?.content?.["application/json"]?.schema;
        if (jsonSchema?.properties) {
          Object.assign(properties, jsonSchema.properties);
        }
        if (Array.isArray(jsonSchema?.required)) {
          for (const r of jsonSchema.required) {
            if (!required.includes(r)) required.push(r);
          }
        }

        out.push({
          name,
          description: String(op.summary ?? op.description ?? `${method.toUpperCase()} ${routePath}`),
          inputSchema: { type: "object", properties, required },
          callTemplate: {
            url: `${baseHref}${routePath.startsWith("/") ? routePath : `/${routePath}`}`,
            method: method.toUpperCase()
          }
        });
      }
    }
    return out;
  }

  throw new Error("Endpoint did not return a valid UTCP manual or OpenAPI 3.x specification.");
}

/**
 * Executes a discovered UTCP/OpenAPI HTTP tool directly against its endpoint without wrapper proxies.
 */
export async function callUtcpTool(
  endpointUrl: string,
  toolDef: ExternalConnectorTool,
  args: Record<string, unknown>,
  creds?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const method = (toolDef.callTemplate?.method ?? "POST").toUpperCase();
  const remaining = { ...args };
  const rawTemplateUrl = toolDef.callTemplate?.url ?? endpointUrl;

  const substituted = rawTemplateUrl.replace(
    /(?:\{|%7[bB])([a-zA-Z0-9_.-]+)(?:\}|%7[dD])/g,
    (_m, key: string) => {
      const val = remaining[key];
      delete remaining[key];
      return val === undefined ? "" : encodeURIComponent(String(val));
    }
  );

  const targetUrl = await assertSafeExternalUrl(substituted);
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(toolDef.callTemplate?.headers ?? {}),
    ...buildAuthHeaders(creds)
  };

  let body: string | undefined;
  if (method === "GET" || method === "HEAD" || method === "DELETE") {
    for (const [k, v] of Object.entries(remaining)) {
      if (v !== undefined && v !== null) {
        targetUrl.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      }
    }
  } else {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    body = JSON.stringify(remaining);
  }

  const res = await fetch(targetUrl.href, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS)
  });

  const text = await readBoundedText(res);
  if (!res.ok) {
    throw new Error(`UTCP HTTP ${res.status} (${method} ${targetUrl.pathname}): ${text.slice(0, 200)}`);
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { data: parsed };
  } catch {
    return { text };
  }
}
