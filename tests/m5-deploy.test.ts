import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDbConnection, ensureSchema, tenants } from "@lutic/core";
import { bootstrapDatabase } from "../packages/core/src/db/bootstrap";
import { validateProductionConfig } from "../packages/core/src/production-config";
import {
  handleLicenseRequest,
  resetLicenseStore
} from "./fixtures/mock-license-server";

const ROOT = path.resolve(__dirname, "..");

describe("Milestone 5 — Client Docker Container & Linux Deployment CLI", () => {
  it("provides Dockerfile, .dockerignore, and full docker-compose stack with license validation", () => {
    const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("FROM ");
    expect(dockerfile).toContain("EXPOSE 3000");
    expect(dockerfile).toContain("bun run build");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("/api/health");

    expect(fs.existsSync(path.join(ROOT, ".dockerignore"))).toBe(true);

    const compose = fs.readFileSync(path.join(ROOT, "docker-compose.yml"), "utf-8");
    expect(compose).toContain("services:");
    expect(compose).toContain("pgvector/pgvector:pg16");
    expect(compose).toContain("litellm:");
    expect(compose).toContain("lutic-paas:");
    expect(compose).toContain("LUTIC_AI_GATEWAY_URL");
    expect(compose).toContain("LUTIC_LICENSE_KEY");
    expect(compose).toContain("LICENSE_SERVER_URL");
    expect(compose).toContain("DATABASE_URL");
    expect(compose).toContain("/api/health");
    expect(fs.existsSync(path.join(ROOT, "deploy/litellm_config.yaml"))).toBe(true);

    const envExample = fs.readFileSync(
      path.join(ROOT, "deploy/lutic.env.example"),
      "utf-8"
    );
    expect(envExample).toContain("LUTIC_AI_GATEWAY_URL=");
    expect(envExample).toContain("LUTIC_LICENSE_KEY=");
    expect(envExample).toContain("LICENSE_SERVER_URL=");
  });

  it("passes bash syntax check, --help, and --dry-run on Linux deployment and backup scripts", () => {
    const deployScript = path.join(ROOT, "deploy/lutic-linux-deploy.sh");
    const wrapperScript = path.join(ROOT, "deploy/lutic.sh");
    const backupScript = path.join(ROOT, "deploy/backup-restore.sh");

    expect(fs.existsSync(deployScript)).toBe(true);
    expect(fs.existsSync(wrapperScript)).toBe(true);
    expect(fs.existsSync(backupScript)).toBe(true);

    execFileSync("bash", ["-n", deployScript], { stdio: "pipe" });
    execFileSync("bash", ["-n", wrapperScript], { stdio: "pipe" });
    execFileSync("bash", ["-n", backupScript], { stdio: "pipe" });

    const helpOut = execFileSync("bash", [deployScript, "--help"], {
      encoding: "utf-8"
    });
    expect(helpOut).toMatch(/license/i);
    expect(helpOut).toMatch(/deploy/i);

    const backupHelp = execFileSync("bash", [backupScript, "--help"], {
      encoding: "utf-8"
    });
    expect(backupHelp).toContain("restore-verify");
    const backupDry = execFileSync(
      "bash",
      [backupScript, "backup", "--output", "/tmp/lutic-test.dump", "--encrypt", "--dry-run"],
      { encoding: "utf-8" }
    );
    expect(backupDry).toContain("[dry-run]");
    const restoreDry = execFileSync(
      "bash",
      [
        backupScript,
        "restore-verify",
        "--input",
        "/tmp/lutic-test.dump.enc",
        "--target-db-url",
        "postgres://u:p@127.0.0.1:5432/isolated_restore",
        "--dry-run"
      ],
      { encoding: "utf-8" }
    );
    expect(restoreDry).toContain("[dry-run]");

    const ciWorkflow = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf-8");
    expect(ciWorkflow).toContain("container-smoke");
    expect(ciWorkflow).toContain("/api/health/live");

    const dryOut = execFileSync(
      "bash",
      [
        deployScript,
        "--dry-run",
        "--license-key",
        "LUTIC-PRO-VALID-2026",
        "--license-server",
        "http://127.0.0.1:4100"
      ],
      { encoding: "utf-8" }
    );
    expect(dryOut).toContain("[dry-run]");
    expect(dryOut).not.toContain("LUTIC-PRO-VALID-2026");
  });

  it("sends { key, instanceId } accepted by @lutic/license-server on activate and reuses .env settings", async () => {
    resetLicenseStore();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lutic-deploy-test-"));
    try {
      const binDir = path.join(tmpDir, "bin");
      fs.mkdirSync(binDir);
      const captureFile = path.join(tmpDir, "curl-body.json");
      const envFile = path.join(tmpDir, "lutic.env");

      // Mock curl captures -d payload & URL and emits valid response
      const curlShim = path.join(binDir, "curl");
      fs.writeFileSync(
        curlShim,
        `#!/usr/bin/env bash
set -euo pipefail
payload=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--data) [[ "$2" == @- ]]; payload="$(cat)"; shift 2 ;;
    -w|-X|-H) shift 2 ;;
    *) shift ;;
  esac
done
printf '%s' "$payload" > "${captureFile}"
printf '{"valid":true,"status":"active","plan":"pro"}\\n200'
`,
        { mode: 0o755 }
      );

      fs.writeFileSync(envFile, "LUTIC_LICENSE_KEY=LUTIC-PRO-VALID-2026\nLICENSE_SERVER_URL=http://127.0.0.1:4100\n");
      const deployScript = path.join(ROOT, "deploy/lutic-linux-deploy.sh");
      execFileSync(
        "bash",
        [
          deployScript,
          "activate",
          "--license-key",
          "LUTIC-PRO-VALID-2026",
          "--license-server",
          "http://127.0.0.1:4100",
          "--env-file",
          envFile
        ],
        {
          encoding: "utf-8",
          env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` }
        }
      );

      const capturedBody = fs.readFileSync(captureFile, "utf-8");
      const parsed = JSON.parse(capturedBody) as { key?: string; instanceId?: string };
      expect(parsed.key).toBe("LUTIC-PRO-VALID-2026");
      expect(parsed.instanceId).toBeTruthy();

      // Feed exact script wire body into real reference license server handler
      const res = await handleLicenseRequest(
        new Request("http://127.0.0.1:4100/api/licenses/activate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: capturedBody
        })
      );
      expect(res.status).toBe(200);
      const resJson = (await res.json()) as { valid?: boolean; status?: string };
      expect(resJson.valid).toBe(true);
      expect(resJson.status).toBe("active");

      // Subsequent `up --dry-run` with bundled internal DNS URL in .env loads key & maps to localhost for host checks
      fs.appendFileSync(envFile, "\nLUTIC_PORT=3123\n");
      execFileSync(
        "sed",
        ["-i.bak", "s|http://127.0.0.1:4100|http://lutic-license-server:4100|g", envFile]
      );
      const envDryOut = execFileSync(
        "bash",
        [deployScript, "up", "--dry-run", "--env-file", envFile],
        // CI disables license enforcement globally; this case proves the env-file
        // license settings are honored when enforcement is explicitly enabled.
        { encoding: "utf-8", env: { ...process.env, LICENSE_ENFORCE: "true" } }
      );
      expect(envDryOut).not.toContain("LUTIC-PRO-VALID-2026");
      expect(envDryOut).toContain("http://127.0.0.1:4100/api/licenses/activate");
      expect(envDryOut).toContain("http://127.0.0.1:3123/api/health");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("blocks restore-verify against equivalent live URLs, .env.production DATABASE_URL, and non-isolated database names", () => {
    const backupScript = path.join(ROOT, "deploy/backup-restore.sh");

    const runRestoreDry = (args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
      const cleanEnv = { ...process.env };
      delete cleanEnv.DATABASE_URL;
      return spawnSync(
        "bash",
        [backupScript, "restore-verify", "--input", "/tmp/lutic.dump", "--dry-run", ...args],
        {
          cwd: opts?.cwd ?? ROOT,
          env: { ...cleanEnv, ...(opts?.env ?? {}) },
          encoding: "utf-8"
        }
      );
    };

    const equivLive = runRestoreDry(
      ["--target-db-url", "postgres://u2:p2@127.0.0.1/lutic?sslmode=disable"],
      { env: { DATABASE_URL: "postgresql://u1:p1@localhost:5432/lutic" } }
    );
    expect(equivLive.status).not.toBe(0);
    expect(equivLive.stderr).toMatch(/live or configured DATABASE_URL/i);

    const nonIsolated = runRestoreDry(["--target-db-url", "postgres://u:p@127.0.0.1:5432/lutic"]);
    expect(nonIsolated.status).not.toBe(0);
    expect(nonIsolated.stderr).toMatch(/isolated restore\/verify\/test/i);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lutic-restore-env-test-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, ".env.production"),
        "DATABASE_URL=postgres://produser:prodpass@localhost:5432/lutic_restore_staging\n"
      );
      const matchedEnvProd = runRestoreDry(
        ["--target-db-url", "postgresql://other:pass@127.0.0.1/lutic_restore_staging"],
        { cwd: tmpDir }
      );
      expect(matchedEnvProd.status).not.toBe(0);
      expect(matchedEnvProd.stderr).toMatch(/live or configured DATABASE_URL/i);

      const isolatedOk = runRestoreDry(
        ["--target-db-url", "postgres://u:p@127.0.0.1:5432/lutic_restore_verify"],
        { cwd: tmpDir }
      );
      expect(isolatedOk.status).toBe(0);
      expect(isolatedOk.stdout).toContain("[dry-run]");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("includes Docker key-rotation configuration and validates container-smoke bootstrap env against production config", async () => {
    const compose = fs.readFileSync(path.join(ROOT, "docker-compose.yml"), "utf-8");
    expect(compose).toContain("AUTH_SECRET_PREVIOUS");
    expect(compose).toContain("CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS");
    expect(compose).toContain("DATA_RETENTION_DAYS");

    const envExample = fs.readFileSync(path.join(ROOT, "deploy/lutic.env.example"), "utf-8");
    expect(envExample).toContain("AUTH_SECRET_PREVIOUS=");
    expect(envExample).toContain("CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS=");
    expect(envExample).toContain("DATA_RETENTION_DAYS=90");

    const ciWorkflow = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf-8");
    const bootstrapBlock = ciWorkflow.split("- name: Bootstrap production schema and first tenant")[1]?.split("- name:")[0] ?? "";
    expect(bootstrapBlock).toBeTruthy();
    const envMatches = Array.from(
      bootstrapBlock.matchAll(/^\s*-e\s+([A-Z0-9_]+)=(?:"([^"]*)"|([^\s\\]+))/gm)
    );
    const ciEnv: Record<string, string> = {};
    for (const m of envMatches) {
      if (m[1]) {
        ciEnv[m[1]] = m[2] ?? m[3] ?? "";
      }
    }
    expect(ciEnv.LUTIC_ADMIN_EMAIL).toBeTruthy();
    expect(ciEnv.LUTIC_ADMIN_PASSWORD).toBeTruthy();
    expect(ciEnv.LUTIC_TENANT_NAME).toBeTruthy();
    expect(ciEnv.LUTIC_PLANT_NAME).toBeTruthy();
    expect(ciWorkflow).toContain("rotate-keys.ts");

    expect(() => validateProductionConfig(ciEnv as NodeJS.ProcessEnv)).not.toThrow();

    const conn = await createDbConnection("memory://");
    try {
      await ensureSchema(conn);
      expect(await bootstrapDatabase(conn, ciEnv as NodeJS.ProcessEnv)).toBe(true);
      expect(await bootstrapDatabase(conn, ciEnv as NodeJS.ProcessEnv)).toBe(false);
    } finally {
      await conn.close();
    }
  });

  it("handles fresh, empty initialized, populated, and equivalent live URL targets in restore-verify preflight", async () => {
    const backupScript = path.join(ROOT, "deploy/backup-restore.sh");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lutic-restore-preflight-"));
    try {
      const binDir = path.join(tmpDir, "bin");
      fs.mkdirSync(binDir);
      const restoreLog = path.join(tmpDir, "pg_restore.log");
      const pgRestoreShim = path.join(binDir, "pg_restore");
      fs.writeFileSync(
        pgRestoreShim,
        `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${restoreLog}"
`,
        { mode: 0o755 }
      );
      const dumpFile = path.join(tmpDir, "lutic-backup.dump");
      fs.writeFileSync(dumpFile, "PGDMP-MOCK");

      const runRestore = (targetUrl: string, extraArgs: string[] = [], extraEnv: NodeJS.ProcessEnv = {}) => {
        const cleanEnv = { ...process.env };
        delete cleanEnv.DATABASE_URL;
        return spawnSync(
          "bash",
          [backupScript, "restore-verify", "--input", dumpFile, "--target-db-url", targetUrl, ...extraArgs],
          {
            cwd: tmpDir,
            env: {
              ...cleanEnv,
              PATH: `${binDir}:${process.env.PATH ?? ""}`,
              ...extraEnv
            },
            encoding: "utf-8"
          }
        );
      };

      // 1. Fresh uninitialized PGlite database (no public.tenants table) -> succeeds without --allow-overwrite
      const freshDir = path.join(tmpDir, "lutic-fresh-restore");
      const freshRes = runRestore(`pglite://${freshDir}`);
      expect(freshRes.status, freshRes.stderr).toBe(0);
      expect(freshRes.stdout).toContain("Restored and verified migrations: [1,2,3]");
      expect(fs.readFileSync(restoreLog, "utf8")).toContain(freshDir);

      // 2. Empty initialized database (schema exists, public.tenants has 0 rows) -> succeeds without --allow-overwrite
      const emptyInitDir = path.join(tmpDir, "lutic-empty-init-verify");
      const emptyConn = await createDbConnection(`pglite://${emptyInitDir}`);
      try {
        await ensureSchema(emptyConn);
      } finally {
        await emptyConn.close();
      }
      const emptyRes = runRestore(`pglite://${emptyInitDir}`);
      expect(emptyRes.status, emptyRes.stderr).toBe(0);
      expect(emptyRes.stdout).toContain("Isolated restore verification succeeded.");

      // 3. Populated database (public.tenants has 1 row) -> refused before pg_restore unless --allow-overwrite is set
      const populatedDir = path.join(tmpDir, "lutic-populated-test");
      const popConn = await createDbConnection(`pglite://${populatedDir}`);
      try {
        await ensureSchema(popConn);
        await popConn.db.insert(tenants).values({
          id: "t-existing",
          name: "Existing Tenant",
          slug: "existing-tenant"
        });
      } finally {
        await popConn.close();
      }
      const logLenBefore = fs.readFileSync(restoreLog, "utf8").length;
      const refusedPop = runRestore(`pglite://${populatedDir}`);
      expect(refusedPop.status).not.toBe(0);
      expect(refusedPop.stderr).toContain("without --allow-overwrite");
      expect(fs.readFileSync(restoreLog, "utf8").length).toBe(logLenBefore);

      const allowedPop = runRestore(`pglite://${populatedDir}`, ["--allow-overwrite"]);
      expect(allowedPop.status, allowedPop.stderr).toBe(0);
      expect(allowedPop.stdout).toContain("Isolated restore verification succeeded.");

      // 4. Equivalent live URL (Postgres or PGlite path alias) -> refused even with --allow-overwrite
      const liveEquivRes = runRestore(
        "postgres://other:pw@127.0.0.1/lutic_restore_live?sslmode=disable",
        ["--allow-overwrite"],
        { DATABASE_URL: "postgresql://main:pw@localhost:5432/lutic_restore_live" }
      );
      expect(liveEquivRes.status).not.toBe(0);
      expect(liveEquivRes.stderr).toMatch(/live or configured DATABASE_URL/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
