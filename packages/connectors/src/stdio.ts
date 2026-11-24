import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDbConnection, type SessionUser } from "@lutic/core";
import { ALL_CONNECTORS } from "./registry";
import { toolContextStorage } from "./types";

async function main() {
  const kind = process.argv[2] ?? "docs";
  const connector = ALL_CONNECTORS.find((c) => c.kind === kind);
  if (!connector) {
    console.error(
      `Unknown connector '${kind}'. Available: ${ALL_CONNECTORS.map((c) => c.kind).join(", ")}`
    );
    process.exit(1);
  }

  const conn = await createDbConnection();
  const server = connector.createMcpServer();
  const transport = new StdioServerTransport();

  const stdioUser: SessionUser = {
    userId: process.env.MCP_USER_ID ?? "user-admin",
    tenantId: process.env.MCP_TENANT_ID ?? "tenant-acme",
    role: "admin",
    plantIds: (process.env.MCP_PLANT_IDS ?? "plant-detroit,plant-austin").split(","),
    email: "stdio@lutic.local",
    name: "Stdio Connector"
  };

  await toolContextStorage.run(
    {
      db: conn.db,
      user: stdioUser,
      requestId: "stdio-session"
    },
    async () => {
      await server.connect(transport);
    }
  );
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("stdio.ts");

if (isMain) {
  main().catch((err) => {
    console.error("MCP stdio server error:", err);
    process.exit(1);
  });
}
