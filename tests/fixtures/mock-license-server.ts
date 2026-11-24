import crypto from "node:crypto";
import http from "node:http";

declare const Bun:
  | {
      serve(options: {
        port: number;
        hostname?: string;
        fetch: (req: Request) => Promise<Response> | Response;
      }): { port: number; stop: (closeActiveConnections?: boolean) => void };
    }
  | undefined;

export interface LicenseRecord {
  key: string;
  plan: string;
  expiresAt: string;
  revoked: boolean;
  maxInstances: number;
  instances: Set<string>;
}

const DEFAULT_SIGNING_SECRET = "kojo-dev-license-signing-secret-2026";

function getSigningSecret(): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The bundled reference license server is for development");
  }
  return process.env.LICENSE_SIGNING_SECRET || DEFAULT_SIGNING_SECRET;
}

const licenseStore = new Map<string, LicenseRecord>();

export function resetLicenseStore(): void {
  licenseStore.clear();
  const seeds: Array<Omit<LicenseRecord, "instances">> = [
    {
      key: "KOJO-DEV-VALID-0001",
      plan: "enterprise",
      expiresAt: "2099-12-31T23:59:59.000Z",
      revoked: false,
      maxInstances: 100
    },
    {
      key: "KOJO-PRO-VALID-2026",
      plan: "pro",
      expiresAt: "2099-12-31T23:59:59.000Z",
      revoked: false,
      maxInstances: 10
    },
    {
      key: "KOJO-EXP-0000-0001",
      plan: "pro",
      expiresAt: "2020-01-01T00:00:00.000Z",
      revoked: false,
      maxInstances: 5
    },
    {
      key: "KOJO-REV-0000-0001",
      plan: "pro",
      expiresAt: "2099-12-31T23:59:59.000Z",
      revoked: true,
      maxInstances: 5
    }
  ];

  for (const s of seeds) {
    licenseStore.set(s.key, { ...s, instances: new Set() });
  }

  const extra = process.env.LICENSE_EXTRA_KEYS ?? "";
  for (const raw of extra.split(",")) {
    const key = raw.trim();
    if (key && !licenseStore.has(key)) {
      licenseStore.set(key, {
        key,
        plan: "enterprise",
        expiresAt: "2099-12-31T23:59:59.000Z",
        revoked: false,
        maxInstances: 50,
        instances: new Set()
      });
    }
  }
}

resetLicenseStore();

export function signLicense(payload: {
  key: string;
  status: string;
  plan: string;
  expiresAt: string;
  instanceId?: string;
}): string {
  const canonical = `${payload.key}|${payload.status}|${payload.plan}|${payload.expiresAt}|${payload.instanceId ?? ""}`;
  return crypto
    .createHmac("sha256", getSigningSecret())
    .update(canonical)
    .digest("hex");
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function evaluateRecord(key: string):
  | { ok: true; record: LicenseRecord }
  | { ok: false; statusCode: number; body: Record<string, unknown> } {
  if (!key) {
    return {
      ok: false,
      statusCode: 400,
      body: { valid: false, status: "missing", reason: "License key is required." }
    };
  }

  const record = licenseStore.get(key);
  if (!record) {
    return {
      ok: false,
      statusCode: 403,
      body: { valid: false, status: "invalid", reason: "Invalid license key." }
    };
  }

  if (record.revoked) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        valid: false,
        status: "revoked",
        reason: "License key has been revoked."
      }
    };
  }

  if (Date.parse(record.expiresAt) <= Date.now()) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        valid: false,
        status: "expired",
        reason: "License key has expired.",
        expiresAt: record.expiresAt
      }
    };
  }

  return { ok: true, record };
}

export async function handleLicenseRequest(req: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return jsonResponse({ error: "The bundled reference license server is for development" }, 503);
  }
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && path === "/health") {
    return jsonResponse({ ok: true, service: "kojo-license-server" });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return jsonResponse(
      { valid: false, status: "invalid", reason: "Invalid JSON body." },
      400
    );
  }

  const key = typeof body.key === "string" ? body.key.trim() : "";
  const instanceId =
    typeof body.instanceId === "string" && body.instanceId.trim()
      ? body.instanceId.trim()
      : "default-instance";

  if (path === "/api/licenses/activate") {
    const check = evaluateRecord(key);
    if (!check.ok) {
      return jsonResponse(check.body, check.statusCode);
    }
    const { record } = check;
    if (!record.instances.has(instanceId) && record.instances.size >= record.maxInstances) {
      return jsonResponse(
        {
          valid: false,
          status: "invalid",
          reason: "Maximum activated instances exceeded for this license key."
        },
        403
      );
    }
    record.instances.add(instanceId);
    const signature = signLicense({
      key: record.key,
      status: "active",
      plan: record.plan,
      expiresAt: record.expiresAt,
      instanceId
    });
    return jsonResponse({
      valid: true,
      status: "active",
      plan: record.plan,
      expiresAt: record.expiresAt,
      instanceId,
      signature
    });
  }

  if (path === "/api/licenses/validate") {
    const check = evaluateRecord(key);
    if (!check.ok) {
      return jsonResponse(check.body, check.statusCode);
    }
    const { record } = check;
    const signature = signLicense({
      key: record.key,
      status: "active",
      plan: record.plan,
      expiresAt: record.expiresAt,
      instanceId
    });
    return jsonResponse({
      valid: true,
      status: "active",
      plan: record.plan,
      expiresAt: record.expiresAt,
      instanceId,
      signature
    });
  }

  if (path === "/api/licenses/revoke") {
    if (!key) {
      return jsonResponse({ ok: false, reason: "License key is required." }, 400);
    }
    const record = licenseStore.get(key);
    if (!record) {
      return jsonResponse({ ok: false, reason: "License key not found." }, 404);
    }
    record.revoked = true;
    return jsonResponse({ ok: true, key, status: "revoked" });
  }

  return jsonResponse({ error: "Not found" }, 404);
}

export async function startLicenseServer(
  port = Number(process.env.PORT ?? 4100)
): Promise<{ port: number; stop: () => Promise<void> }> {
  getSigningSecret();
  if (typeof Bun !== "undefined") {
    const server = Bun.serve({
      port,
      fetch: handleLicenseRequest
    });
    return {
      port: server.port,
      stop: async () => {
        server.stop(true);
      }
    };
  }

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const bodyBuf = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(", "));
    }
    const webReq = new Request(`http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`, {
      method: req.method ?? "GET",
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? bodyBuf : undefined
    });
    const webRes = await handleLicenseRequest(webReq);
    res.statusCode = webRes.status;
    webRes.headers.forEach((v, k) => res.setHeader(k, v));
    const resBuf = Buffer.from(await webRes.arrayBuffer());
    res.end(resBuf);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  return {
    port: actualPort,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
}
