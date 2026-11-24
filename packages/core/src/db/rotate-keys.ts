import { eq, ne } from "drizzle-orm";
import { rotateEncryptedPayload } from "../crypto";
import { requireCredentialKey, requireProductionDatabaseUrl } from "../production-config";
import { createDbConnection, type LuticDatabase } from "./client";
import { connectorConnections, connectors } from "./schema";

export interface CredentialRotationSummary {
  connectorsRotated: number;
  connectionsRotated: number;
}

export async function rotateStoredCredentials(
  db: LuticDatabase
): Promise<CredentialRotationSummary> {
  return db.transaction(async (tx) => {
    let connectorsRotated = 0;
    let connectionsRotated = 0;

    const legacyConnectors = await tx
      .select({ id: connectors.id, encryptedCredentials: connectors.encryptedCredentials })
      .from(connectors)
      .where(ne(connectors.encryptedCredentials, ""));

    for (const row of legacyConnectors) {
      const { rotated, changed } = rotateEncryptedPayload(row.encryptedCredentials);
      if (changed) {
        await tx
          .update(connectors)
          .set({ encryptedCredentials: rotated, updatedAt: new Date() })
          .where(eq(connectors.id, row.id));
        connectorsRotated += 1;
      }
    }

    const hubConnections = await tx
      .select({
        id: connectorConnections.id,
        encryptedCredentials: connectorConnections.encryptedCredentials
      })
      .from(connectorConnections)
      .where(ne(connectorConnections.encryptedCredentials, ""));

    for (const row of hubConnections) {
      const { rotated, changed } = rotateEncryptedPayload(row.encryptedCredentials);
      if (changed) {
        await tx
          .update(connectorConnections)
          .set({ encryptedCredentials: rotated, updatedAt: new Date() })
          .where(eq(connectorConnections.id, row.id));
        connectionsRotated += 1;
      }
    }

    return { connectorsRotated, connectionsRotated };
  });
}

if (/[\\/]rotate-keys\.ts$/.test(process.argv[1] ?? "")) {
  try {
    if (process.env.NODE_ENV === "production") {
      requireCredentialKey(process.env.CREDENTIAL_ENCRYPTION_KEY);
    }
    const dbUrl =
      process.env.NODE_ENV === "production"
        ? requireProductionDatabaseUrl(process.env.DATABASE_URL)
        : process.env.DATABASE_URL;
    const conn = await createDbConnection(dbUrl);
    try {
      const summary = await rotateStoredCredentials(conn.db);
      console.log(JSON.stringify(summary));
    } finally {
      await conn.close();
    }
  } catch (error) {
    console.error(
      `Credential rotation failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}
