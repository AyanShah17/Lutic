import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sha256Hex } from "./crypto";
import type { KojoDatabase } from "./db/client";
import { logger } from "./logger";

interface RateLimitBucket {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
}

export type RateLimitConsumer = (bucket: RateLimitBucket) => Promise<boolean>;

export async function consumeRateLimit(
  db: Pick<KojoDatabase, "execute">,
  bucket: RateLimitBucket
): Promise<boolean> {
  if (bucket.limit <= 0) return false;

  const nextExpiry = sql`statement_timestamp() + ${bucket.windowMs} * interval '1 millisecond'`;
  const result = await db.execute(sql`
    INSERT INTO rate_limits (scope, bucket_key, expires_at, hits)
    VALUES (${bucket.scope}, ${sha256Hex(bucket.key)}, ${nextExpiry}, 1)
    ON CONFLICT (scope, bucket_key) DO UPDATE SET
      expires_at = CASE WHEN rate_limits.expires_at <= statement_timestamp()
        THEN ${nextExpiry} ELSE rate_limits.expires_at END,
      hits = CASE WHEN rate_limits.expires_at <= statement_timestamp()
        THEN 1 ELSE rate_limits.hits + 1 END
    WHERE rate_limits.expires_at <= statement_timestamp() OR rate_limits.hits < ${bucket.limit}
    RETURNING hits
  `);
  return result.rows.length > 0;
}

export function createPostgresRateLimitConsumer(connectionString: string): RateLimitConsumer {
  // Chat holds a tenant transaction during model calls, so quota writes need their own pool.
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  pool.on("error", (err: Error) => logger.warn({ err }, "PostgreSQL rate limit connection error"));
  const db = drizzle(pool);
  return (bucket) => consumeRateLimit(db, bucket);
}

export async function pruneExpiredRateLimits(db: KojoDatabase): Promise<void> {
  await db.execute(sql`
    DELETE FROM rate_limits
    WHERE (scope, bucket_key) IN (
      SELECT scope, bucket_key FROM rate_limits WHERE expires_at <= clock_timestamp()
      ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED
    )
  `);
}
