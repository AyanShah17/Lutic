import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { SessionUser } from "./rbac";
import { RoleSchema } from "./rbac";
import { requireCredentialKey, requireDeploymentSecret } from "./production-config";

const DEFAULT_DEV_ENC_KEY =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const DEFAULT_DEV_AUTH_SECRET =
  "lutic-local-dev-session-secret-2026-keep-private";

function parseRawKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

function getEncryptionKey(): Buffer {
  const raw = process.env.NODE_ENV === "production"
    ? requireCredentialKey(process.env.CREDENTIAL_ENCRYPTION_KEY)
    : process.env.CREDENTIAL_ENCRYPTION_KEY || DEFAULT_DEV_ENC_KEY;
  return parseRawKey(raw);
}

function getPreviousEncryptionKeys(): Buffer[] {
  const rawList = process.env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS?.trim();
  if (!rawList) return [];
  return rawList
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (process.env.NODE_ENV === "production") {
        return parseRawKey(requireCredentialKey(entry));
      }
      return parseRawKey(entry);
    });
}

function getAuthSecret(): Uint8Array {
  const secret = process.env.NODE_ENV === "production"
    ? requireDeploymentSecret("AUTH_SECRET", process.env.AUTH_SECRET, 32)
    : process.env.AUTH_SECRET || DEFAULT_DEV_AUTH_SECRET;
  return new TextEncoder().encode(secret);
}

function getPreviousAuthSecrets(): Uint8Array[] {
  const rawList = process.env.AUTH_SECRET_PREVIOUS?.trim();
  if (!rawList) return [];
  return rawList
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (process.env.NODE_ENV === "production") {
        requireDeploymentSecret("AUTH_SECRET_PREVIOUS", entry, 32);
      }
      return new TextEncoder().encode(entry);
    });
}

export interface EncryptedEnvelope {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

function encryptWithKey(plaintextObj: Record<string, unknown>, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const json = JSON.stringify(plaintextObj);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope: EncryptedEnvelope = {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64")
  };
  return JSON.stringify(envelope);
}

function decryptWithKey(envelope: EncryptedEnvelope, key: Buffer): Record<string, unknown> {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8")) as Record<string, unknown>;
}

export function encryptCredentials(plaintextObj: Record<string, unknown>): string {
  return encryptWithKey(plaintextObj, getEncryptionKey());
}

export function decryptCredentials(serialized: string): Record<string, unknown> {
  const envelope = JSON.parse(serialized) as EncryptedEnvelope;
  if (envelope.v !== 1 || envelope.alg !== "aes-256-gcm") {
    throw new Error("Unsupported encrypted credential envelope");
  }
  const primary = getEncryptionKey();
  try {
    return decryptWithKey(envelope, primary);
  } catch (primaryErr) {
    for (const prevKey of getPreviousEncryptionKeys()) {
      try {
        return decryptWithKey(envelope, prevKey);
      } catch {
        // try next key in rotation chain
      }
    }
    throw primaryErr;
  }
}

export function rotateEncryptedPayload(serialized: string): {
  rotated: string;
  changed: boolean;
} {
  const envelope = JSON.parse(serialized) as EncryptedEnvelope;
  if (envelope.v !== 1 || envelope.alg !== "aes-256-gcm") {
    throw new Error("Unsupported encrypted credential envelope");
  }
  const primary = getEncryptionKey();
  try {
    decryptWithKey(envelope, primary);
    return { rotated: serialized, changed: false };
  } catch {
    const plaintext = decryptCredentials(serialized);
    return { rotated: encryptWithKey(plaintext, primary), changed: true };
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const salt = parts[1];
  const expectedHex = parts[2];
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export type VerifiedSessionClaims = SessionUser & {
  tokenVersion: number;
};

export async function signSessionToken(
  user: SessionUser,
  options?: { tokenVersion?: number }
): Promise<string> {
  return new SignJWT({
    userId: user.userId,
    tenantId: user.tenantId,
    role: user.role,
    plantIds: user.plantIds,
    email: user.email,
    name: user.name,
    tv: options?.tokenVersion ?? 1
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.userId)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getAuthSecret());
}

export async function verifySessionToken(
  token: string
): Promise<VerifiedSessionClaims | null> {
  const secrets = [getAuthSecret(), ...getPreviousAuthSecrets()];
  for (const secret of secrets) {
    try {
      const { payload } = await jwtVerify(token, secret);
      const roleParsed = RoleSchema.safeParse(payload.role);
      if (
        !roleParsed.success ||
        typeof payload.userId !== "string" ||
        typeof payload.tenantId !== "string" ||
        typeof payload.email !== "string" ||
        typeof payload.name !== "string" ||
        !Array.isArray(payload.plantIds)
      ) {
        return null;
      }
      const tv =
        typeof payload.tv === "number" && Number.isInteger(payload.tv) && payload.tv >= 1
          ? payload.tv
          : 1;
      return {
        userId: payload.userId,
        tenantId: payload.tenantId,
        role: roleParsed.data,
        plantIds: payload.plantIds.filter((p): p is string => typeof p === "string"),
        email: payload.email,
        name: payload.name,
        tokenVersion: tv
      };
    } catch {
      // try next secret if rotating AUTH_SECRET
    }
  }
  return null;
}
