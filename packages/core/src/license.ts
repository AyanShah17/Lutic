import crypto from "node:crypto";
import os from "node:os";
import { eq } from "drizzle-orm";
import type { KojoDatabase } from "./db/client";
import { licenseState } from "./db/schema";
import { requireDeploymentSecret, requireProductionLicenseUrl } from "./production-config";

const DEFAULT_LICENSE_ROW_ID = "default";
const DEFAULT_SIGNING_SECRET = "kojo-dev-license-signing-secret-2026";
const CACHE_TTL_MS = 60_000;

export type LicenseStatusKind =
  | "unactivated"
  | "active"
  | "invalid"
  | "revoked"
  | "expired";

export interface LicenseStatusSnapshot {
  enforced: boolean;
  status: LicenseStatusKind;
  active: boolean;
  plan: string;
  expiresAt: string | null;
  keyHint: string;
  serverUrl: string;
  instanceId: string;
  lastVerifiedAt: string | null;
  activatedAt: string | null;
  reason: string;
}

export interface LicenseActivationResult {
  valid: boolean;
  status: LicenseStatusKind | "missing";
  plan?: string;
  expiresAt?: string | null;
  keyHint?: string;
  reason?: string;
}

interface LicenseCacheEntry {
  active: boolean;
  expiresAtMs: number | null;
  cachedAt: number;
  reason: string;
}

const globalForLicense = globalThis as unknown as {
  __kojoLicenseCache?: LicenseCacheEntry;
};

export class LicenseError extends Error {
  public readonly statusCode = 402;
  public readonly code = "LICENSE_REQUIRED";

  constructor(message: string) {
    super(message);
    this.name = "LicenseError";
  }
}

export function resetLicenseCacheForTests(): void {
  globalForLicense.__kojoLicenseCache = undefined;
}

export function maskLicenseKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 4) return "****";
  return `****-${trimmed.slice(-4)}`;
}

export function verifyLicenseSignature(
  payload: {
    key: string;
    status: string;
    plan: string;
    expiresAt: string;
    instanceId?: string;
  },
  signature: string,
  secret?: string
): boolean {
  if (!signature) return false;
  let signingSecret = secret ?? process.env.LICENSE_SIGNING_SECRET;
  if (process.env.NODE_ENV === "production") {
    try {
      signingSecret = requireDeploymentSecret("LICENSE_SIGNING_SECRET", signingSecret, 32);
    } catch {
      return false;
    }
  }
  const canonical = `${payload.key}|${payload.status}|${payload.plan}|${payload.expiresAt}|${payload.instanceId ?? ""}`;
  const expected = crypto
    .createHmac("sha256", signingSecret || DEFAULT_SIGNING_SECRET)
    .update(canonical)
    .digest("hex");
  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

function normalizePersistedStatus(status: string): LicenseStatusKind {
  if (
    status === "active" ||
    status === "invalid" ||
    status === "revoked" ||
    status === "expired"
  ) {
    return status;
  }
  return "unactivated";
}

async function upsertLicenseRow(
  db: KojoDatabase,
  values: {
    licenseKey: string;
    serverUrl: string;
    instanceId: string;
    status: LicenseStatusKind;
    plan: string;
    signature: string;
    reason: string;
    expiresAt: Date | null;
    lastVerifiedAt: Date | null;
    activatedAt: Date | null;
  }
): Promise<void> {
  const valuesWithTimestamp = { ...values, updatedAt: new Date() };
  await db.insert(licenseState).values({ id: DEFAULT_LICENSE_ROW_ID, ...valuesWithTimestamp })
    .onConflictDoUpdate({ target: licenseState.id, set: valuesWithTimestamp });
}

export async function getLicenseStatus(
  db: KojoDatabase
): Promise<LicenseStatusSnapshot> {
  const enforced = process.env.LICENSE_ENFORCE === "true";
  const rows = await db
    .select()
    .from(licenseState)
    .where(eq(licenseState.id, DEFAULT_LICENSE_ROW_ID))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return {
      enforced,
      status: "unactivated",
      active: false,
      plan: "",
      expiresAt: null,
      keyHint: "",
      serverUrl: process.env.LICENSE_SERVER_URL ?? "http://localhost:4100",
      instanceId: process.env.KOJO_INSTANCE_ID || os.hostname() || "kojo-instance",
      lastVerifiedAt: null,
      activatedAt: null,
      reason: ""
    };
  }

  let status = normalizePersistedStatus(row.status);
  let reason = row.reason;
  if (status === "active" && process.env.NODE_ENV === "production") {
    let issuer: string | undefined;
    try {
      issuer = requireProductionLicenseUrl(process.env.LICENSE_SERVER_URL);
    } catch {
      // A missing or malformed issuer cannot validate a stored license.
    }
    if (row.serverUrl !== issuer || !row.expiresAt || !verifyLicenseSignature({
      key: row.licenseKey,
      status: "active",
      plan: row.plan,
      expiresAt: row.expiresAt.toISOString(),
      instanceId: row.instanceId
    }, row.signature)) {
      status = "invalid";
      reason = "Stored license must be verified by the configured issuer.";
    }
  }
  if (status === "active" && row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    status = "expired";
    reason = "License key has expired.";
  }

  return {
    enforced,
    status,
    active: status === "active",
    plan: row.plan,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    keyHint: maskLicenseKey(row.licenseKey),
    serverUrl: row.serverUrl || process.env.LICENSE_SERVER_URL || "http://localhost:4100",
    instanceId: row.instanceId,
    lastVerifiedAt: row.lastVerifiedAt ? row.lastVerifiedAt.toISOString() : null,
    activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
    reason
  };
}

async function callLicenseServer(
  endpointPath: "/api/licenses/activate" | "/api/licenses/validate",
  db: KojoDatabase,
  input: {
    key: string;
    serverUrl?: string;
    instanceId?: string;
    hostname?: string;
  }
): Promise<LicenseActivationResult> {
  const key = input.key.trim();
  let serverUrl = (
    input.serverUrl?.trim() ||
    process.env.LICENSE_SERVER_URL ||
    "http://localhost:4100"
  ).replace(/\/+$/, "");
  const instanceId =
    input.instanceId?.trim() ||
    process.env.KOJO_INSTANCE_ID ||
    os.hostname() ||
    "kojo-instance";
  const now = new Date();

  if (!key) {
    resetLicenseCacheForTests();
    return { valid: false, status: "missing", reason: "License key is required." };
  }

  const production = process.env.NODE_ENV === "production";
  if (production) {
    try {
      serverUrl = requireProductionLicenseUrl(process.env.LICENSE_SERVER_URL);
      if (input.serverUrl && requireProductionLicenseUrl(input.serverUrl.trim()) !== serverUrl) {
        return { valid: false, status: "invalid", reason: "Use the configured license issuer." };
      }
      requireDeploymentSecret("LICENSE_SIGNING_SECRET", process.env.LICENSE_SIGNING_SECRET, 32);
    } catch (error) {
      return { valid: false, status: "invalid", reason: error instanceof Error ? error.message : "Invalid license issuer configuration." };
    }
  }
  try {
    const res = await fetch(`${serverUrl}${endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key,
        instanceId,
        hostname: input.hostname ?? os.hostname()
      }),
      redirect: "error",
      signal: AbortSignal.timeout(5000)
    });

    const data = (await res.json()) as {
      valid?: boolean;
      status?: string;
      plan?: string;
      expiresAt?: string;
      signature?: string;
      reason?: string;
    };

    if (res.ok && data.valid === true) {
      const plan = data.plan ?? "standard";
      const expiresAtStr = data.expiresAt ?? "";
      const signature = data.signature ?? "";
      const expiry = Date.parse(expiresAtStr);
      const expiresAtDate = Number.isFinite(expiry) ? new Date(expiry) : null;
      if (
        (production && (!expiresAtDate || expiresAtDate.toISOString() !== expiresAtStr || expiry <= now.getTime())) ||
        ((production || signature) && !verifyLicenseSignature(
          { key, status: "active", plan, expiresAt: expiresAtStr, instanceId },
          signature
        ))
      ) {
        resetLicenseCacheForTests();
        await upsertLicenseRow(db, {
          licenseKey: "",
          serverUrl,
          instanceId,
          status: "invalid",
          plan: "",
          signature: "",
          reason: "Invalid license signature from license server.",
          expiresAt: null,
          lastVerifiedAt: now,
          activatedAt: null
        });
        return {
          valid: false,
          status: "invalid",
          reason: "Invalid license signature from license server."
        };
      }

      await upsertLicenseRow(db, {
        licenseKey: key,
        serverUrl,
        instanceId,
        status: "active",
        plan,
        signature,
        reason: "",
        expiresAt: expiresAtDate,
        lastVerifiedAt: now,
        activatedAt: now
      });

      globalForLicense.__kojoLicenseCache = {
        active: true,
        expiresAtMs: expiresAtDate ? expiresAtDate.getTime() : null,
        cachedAt: Date.now(),
        reason: ""
      };

      return {
        valid: true,
        status: "active",
        plan,
        expiresAt: expiresAtDate ? expiresAtDate.toISOString() : null,
        keyHint: maskLicenseKey(key)
      };
    }

    resetLicenseCacheForTests();
    const rawStatus = data.status ?? "invalid";
    const persistedStatus = rawStatus === "active" ? "invalid" : normalizePersistedStatus(rawStatus);
    const reason = data.reason ?? "License validation rejected.";
    await upsertLicenseRow(db, {
      licenseKey: "",
      serverUrl,
      instanceId,
      status: persistedStatus,
      plan: "",
      signature: "",
      reason,
      expiresAt: data.expiresAt && Number.isFinite(Date.parse(data.expiresAt)) ? new Date(data.expiresAt) : null,
      lastVerifiedAt: now,
      activatedAt: null
    });

    return {
      valid: false,
      status: rawStatus === "missing" ? "missing" : persistedStatus,
      reason
    };
  } catch (err) {
    resetLicenseCacheForTests();
    const reason =
      err instanceof Error ? `License server unreachable: ${err.message}` : "License server unreachable.";
    return {
      valid: false,
      status: "invalid",
      reason
    };
  }
}

export async function activateLicense(
  db: KojoDatabase,
  input: { key: string; serverUrl?: string; instanceId?: string; hostname?: string }
): Promise<LicenseActivationResult> {
  return callLicenseServer("/api/licenses/activate", db, input);
}

export async function validateCurrentLicense(
  db: KojoDatabase
): Promise<LicenseActivationResult> {
  const rows = await db
    .select()
    .from(licenseState)
    .where(eq(licenseState.id, DEFAULT_LICENSE_ROW_ID))
    .limit(1);

  const row = rows[0];
  if (!row || !row.licenseKey) {
    resetLicenseCacheForTests();
    return {
      valid: false,
      status: "unactivated",
      reason: "No license key configured."
    };
  }

  return callLicenseServer("/api/licenses/validate", db, {
    key: row.licenseKey,
    serverUrl: row.serverUrl,
    instanceId: row.instanceId
  });
}

export async function deactivateLicense(db: KojoDatabase): Promise<void> {
  resetLicenseCacheForTests();
  await upsertLicenseRow(db, {
    licenseKey: "",
    serverUrl: process.env.LICENSE_SERVER_URL ?? "http://localhost:4100",
    instanceId: process.env.KOJO_INSTANCE_ID || os.hostname() || "kojo-instance",
    status: "unactivated",
    plan: "",
    signature: "",
    reason: "License deactivated by administrator.",
    expiresAt: null,
    lastVerifiedAt: null,
    activatedAt: null
  });
}

export async function requireLicense(db: KojoDatabase): Promise<void> {
  if (process.env.LICENSE_ENFORCE !== "true") return;

  const nowMs = Date.now();
  const cached = globalForLicense.__kojoLicenseCache;
  if (
    cached &&
    cached.active &&
    cached.cachedAt + CACHE_TTL_MS > nowMs &&
    (cached.expiresAtMs === null || cached.expiresAtMs > nowMs)
  ) {
    return;
  }

  let status = await getLicenseStatus(db);
  if (!status.active && process.env.KOJO_LICENSE_KEY?.trim()) {
    // Only auto-activate from env on initial uninitialized boot, never overriding explicit deactivation/revocation/expiry.
    const existingRows = await db
      .select({ id: licenseState.id })
      .from(licenseState)
      .where(eq(licenseState.id, DEFAULT_LICENSE_ROW_ID))
      .limit(1);
    if (existingRows.length === 0) {
      await activateLicense(db, { key: process.env.KOJO_LICENSE_KEY.trim() });
      status = await getLicenseStatus(db);
    }
  }

  if (!status.active) {
    throw new LicenseError(
      status.reason || "Valid Kojo license activation is required."
    );
  }

  globalForLicense.__kojoLicenseCache = {
    active: true,
    expiresAtMs: status.expiresAt ? Date.parse(status.expiresAt) : null,
    cachedAt: nowMs,
    reason: ""
  };
}
