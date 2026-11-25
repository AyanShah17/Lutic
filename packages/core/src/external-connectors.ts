import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const MAX_EXTERNAL_BODY_BYTES = 1024 * 1024;
const EXTERNAL_TIMEOUT_MS = 15_000;

export interface ValidatedExternalTarget {
  url: URL;
  pinnedAddress?: string;
  pinnedFamily?: 4 | 6;
}

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

export function isPrivateOrReservedIp(rawIp: string): boolean {
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
 * isolated local tests via LUTIC_ALLOW_PRIVATE_CONNECTOR_URLS=true) and resolves DNS once to pin
 * public IPs against DNS-rebinding TOCTOU attacks.
 */
export async function resolveSafeExternalTarget(rawUrl: string): Promise<ValidatedExternalTarget> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Invalid connector endpoint URL.");
  }

  const allowPrivate = process.env.LUTIC_ALLOW_PRIVATE_CONNECTOR_URLS === "true";
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
      return {
        url: parsed,
        pinnedAddress: hostname,
        pinnedFamily: (net.isIP(hostname) || 4) as 4 | 6
      };
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
    const primary = resolved[0]!;
    return {
      url: parsed,
      pinnedAddress: primary.address,
      pinnedFamily: (net.isIP(primary.address) || 4) as 4 | 6
    };
  }

  return { url: parsed };
}

export async function assertSafeExternalUrl(rawUrl: string): Promise<URL> {
  return (await resolveSafeExternalTarget(rawUrl)).url;
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

export async function safePinnedHttpRequest(
  rawUrl: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    maxBytes?: number;
  } = {}
): Promise<{
  status: number;
  headers: Record<string, string>;
  text: string;
  url: URL;
}> {
  const target = await resolveSafeExternalTarget(rawUrl);
  const timeoutMs = options.timeoutMs ?? EXTERNAL_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_EXTERNAL_BODY_BYTES;
  const transportMod = target.url.protocol === "https:" ? https : http;
  const port = target.url.port
    ? Number(target.url.port)
    : target.url.protocol === "https:"
      ? 443
      : 80;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error, value?: { status: number; headers: Record<string, string>; text: string; url: URL }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value!);
    };

    const pinnedLookup = target.pinnedAddress
      ? ((
          _hostname: string,
          lookupOpts: { all?: boolean } | ((e: Error | null, a: unknown, f?: number) => void),
          maybeCb?: (e: Error | null, a: unknown, f?: number) => void
        ) => {
          const cb = typeof lookupOpts === "function" ? lookupOpts : maybeCb;
          if (!cb) return;
          const family = target.pinnedFamily ?? 4;
          if (typeof lookupOpts === "object" && lookupOpts?.all) {
            cb(null, [{ address: target.pinnedAddress!, family }]);
          } else {
            cb(null, target.pinnedAddress!, family);
          }
        }) as unknown as net.LookupFunction
      : undefined;

    const req = transportMod.request(
      {
        hostname: target.url.hostname.replace(/^\[|\]$/g, ""),
        port,
        path: `${target.url.pathname}${target.url.search}`,
        method: options.method ?? "GET",
        headers: options.headers,
        ...(pinnedLookup ? { lookup: pinnedLookup } : {}),
        ...(target.url.protocol === "https:" ? { servername: target.url.hostname } : {})
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.destroy();
          req.destroy();
          finish(new Error(`Redirect blocked (${status}) for external connector.`));
          return;
        }

        const normHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") normHeaders[k.toLowerCase()] = v;
          else if (Array.isArray(v) && v.length > 0) normHeaders[k.toLowerCase()] = v.join(", ");
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buf.byteLength;
          if (total > maxBytes) {
            res.destroy();
            req.destroy();
            finish(new Error(`External connector response exceeded ${maxBytes} bytes.`));
            return;
          }
          chunks.push(buf);
        });
        res.on("end", () => {
          finish(undefined, {
            status,
            headers: normHeaders,
            text: Buffer.concat(chunks).toString("utf8"),
            url: target.url
          });
        });
        res.on("error", (err) => finish(err));
      }
    );

    const timer = setTimeout(() => {
      req.destroy();
      finish(new Error(`External connector request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    req.on("error", (err) => finish(err));
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...buildAuthHeaders(creds)
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  const res = await safePinnedHttpRequest(endpointUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `lutic-${Date.now()}`,
      method,
      params
    })
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Remote MCP HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  }

  const payload = parseMcpResponseBody(res.text, res.headers["content-type"] ?? "");
  if (payload.error && typeof payload.error === "object") {
    const errMsg = String((payload.error as { message?: unknown }).message ?? "Remote MCP error");
    throw new Error(errMsg);
  }
  const returnedSessionId = res.headers["mcp-session-id"] ?? sessionId;
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
      clientInfo: { name: "lutic", version: "0.1.0" }
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
      clientInfo: { name: "lutic", version: "0.1.0" }
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
  const res = await safePinnedHttpRequest(endpointUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...buildAuthHeaders(creds)
    }
  });
  const safeUrl = res.url;

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`UTCP/OpenAPI manual fetch failed (${res.status}): ${res.text.slice(0, 200)}`);
  }
  const doc = JSON.parse(res.text) as Record<string, unknown>;

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
  const connectorUrl = await assertSafeExternalUrl(endpointUrl);
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
    ...(targetUrl.origin === connectorUrl.origin ? buildAuthHeaders(creds) : {})
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

  const res = await safePinnedHttpRequest(targetUrl.href, {
    method,
    headers,
    ...(body !== undefined ? { body } : {})
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`UTCP HTTP ${res.status} (${method} ${targetUrl.pathname}): ${res.text.slice(0, 200)}`);
  }

  try {
    const parsed = JSON.parse(res.text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { data: parsed };
  } catch {
    return { text: res.text };
  }
}
