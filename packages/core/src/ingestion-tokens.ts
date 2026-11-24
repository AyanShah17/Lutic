import crypto from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { sha256Hex } from "./crypto";
import type { KojoDatabase } from "./db/client";
import { ingestionTokens } from "./db/schema";

export interface AuthenticatedIngestionToken {
  id: string;
  tenantId: string;
  plantId: string;
  name: string;
  scopes: string[];
  expiresAt: Date | null;
}

export function isIngestionTokenFormat(rawToken: string): boolean {
  return rawToken.startsWith("kjt_") && rawToken.length >= 24;
}

export function generateIngestionTokenSecret(): {
  rawToken: string;
  tokenPrefix: string;
  tokenHash: string;
} {
  const rawToken = `kjt_${crypto.randomBytes(24).toString("base64url")}`;
  return {
    rawToken,
    tokenPrefix: rawToken.slice(0, 12),
    tokenHash: sha256Hex(rawToken)
  };
}

export async function authenticateIngestionToken(
  db: KojoDatabase,
  rawToken: string
): Promise<AuthenticatedIngestionToken | null> {
  if (!isIngestionTokenFormat(rawToken)) return null;
  const tokenHash = sha256Hex(rawToken);
  const now = new Date();
  const rows = await db
    .update(ingestionTokens)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(ingestionTokens.tokenHash, tokenHash),
        eq(ingestionTokens.active, true),
        isNull(ingestionTokens.revokedAt),
        or(isNull(ingestionTokens.expiresAt), gt(ingestionTokens.expiresAt, now))
      )
    )
    .returning();

  const row = rows[0];
  if (!row || !row.scopes.includes("telemetry:write")) return null;

  return {
    id: row.id,
    tenantId: row.tenantId,
    plantId: row.plantId,
    name: row.name,
    scopes: row.scopes,
    expiresAt: row.expiresAt
  };
}
