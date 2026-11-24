import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";

export type KojoDatabase =
  | PgliteDatabase<typeof schema>
  | NodePgDatabase<typeof schema>;

export interface DbPoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

export interface DbConnection {
  db: KojoDatabase;
  dialect: "pglite" | "postgres";
  executeRaw: (statement: string) => Promise<void>;
  withRawTransaction?: <T>(
    fn: (
      execute: (statement: string) => Promise<void>,
      queryRows: <R = Record<string, unknown>>(
        statement: string,
        params?: unknown[]
      ) => Promise<R[]>
    ) => Promise<T>
  ) => Promise<T>;
  getPoolStats?: () => DbPoolStats | null;
  close: () => Promise<void>;
}

function findWorkspaceRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string };
        if (parsed.name === "kojo") {
          return dir;
        }
      } catch {
        // ignore invalid json
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

function resolvePgliteDataDir(rawUrl: string): string {
  if (rawUrl === "memory://" || rawUrl === "pglite://memory") {
    return "memory://";
  }
  const stripped = rawUrl.replace(/^pglite:\/\//, "");
  if (path.isAbsolute(stripped)) {
    fs.mkdirSync(stripped, { recursive: true });
    return stripped;
  }
  const root = findWorkspaceRoot(process.cwd());
  const target = path.resolve(root, stripped || ".data/pglite");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

export async function createDbConnection(
  connectionUrl?: string
): Promise<DbConnection> {
  const url = connectionUrl ?? process.env.DATABASE_URL ?? "pglite://.data/pglite";

  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
    const pool = new Pool({ connectionString: url });
    const db = drizzlePg(pool, { schema });
    return {
      db,
      dialect: "postgres",
      executeRaw: async (statement: string) => {
        await pool.query(statement);
      },
      withRawTransaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn(
            async (statement: string) => {
              await client.query(statement);
            },
            async <R = Record<string, unknown>>(statement: string, params?: unknown[]) => {
              const res = await client.query(statement, params);
              return res.rows as R[];
            }
          );
          await client.query("COMMIT");
          return result;
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      getPoolStats: () => ({
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      }),
      close: async () => {
        await pool.end();
      }
    };
  }

  const dataDir = resolvePgliteDataDir(url);
  const client =
    dataDir === "memory://"
      ? new PGlite({ extensions: { vector } })
      : new PGlite(dataDir, { extensions: { vector } });
  await client.waitReady;
  const db = drizzlePglite(client, { schema });
  return {
    db,
    dialect: "pglite",
    executeRaw: async (statement: string) => {
      await client.exec(statement);
    },
    withRawTransaction: async (fn) => {
      return client.transaction(async (tx) =>
        fn(
          async (statement: string) => {
            await tx.exec(statement);
          },
          async <R = Record<string, unknown>>(statement: string, params?: unknown[]) => {
            const res = await tx.query<R>(statement, params);
            return res.rows;
          }
        )
      );
    },
    getPoolStats: () => null,
    close: async () => {
      await client.close();
    }
  };
}

const globalForDb = globalThis as unknown as {
  __kojoConnPromise?: Promise<DbConnection>;
  __kojoSchemaReady?: Promise<void>;
};

export async function getDbConnection(): Promise<DbConnection> {
  if (!globalForDb.__kojoConnPromise) {
    globalForDb.__kojoConnPromise = createDbConnection();
  }
  return globalForDb.__kojoConnPromise;
}

export async function getDb(): Promise<KojoDatabase> {
  const conn = await getDbConnection();
  return conn.db;
}

/**
 * Runs callbacks inside a transaction with Postgres session variable `app.current_tenant_id`
 * set so Postgres Row-Level Security (RLS) policies enforce tenant isolation at the DB engine level.
 */
export async function withTenantScope<T>(
  db: KojoDatabase,
  tenantId: string,
  fn: (tx: KojoDatabase) => Promise<T>
): Promise<T> {
  if (!tenantId.trim()) throw new Error("A tenant ID is required for scoped database access");
  return (await (db as PgliteDatabase<typeof schema>).transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE kojo_app`);
    await tx.execute(
      sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    );
    return fn(tx as unknown as KojoDatabase);
  })) as T;
}

export function resetGlobalDbForTests(): void {
  globalForDb.__kojoConnPromise = undefined;
  globalForDb.__kojoSchemaReady = undefined;
}
