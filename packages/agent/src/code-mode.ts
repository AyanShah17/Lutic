import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { isCodeModeEnabled } from "@kojo/core";
import { defaultMcpRegistry, type ToolExecutionContext } from "@kojo/connectors";
import {
  executeToolWithPolicy,
  getAllowedToolsForUser,
  type PolicyCheckOptions,
  type PolicyEvaluationResult
} from "./policy";

export const MAX_CODE_MODE_LENGTH = 4000;
export const DEFAULT_CODE_MODE_MAX_CALLS = 8;
export const DEFAULT_CODE_MODE_TIMEOUT_MS = 5000;
const MAX_WORKER_STDOUT_BYTES = 256 * 1024;

export interface KojoCodeModeInnerCall {
  toolName: string;
  args: Record<string, unknown>;
  status: PolicyEvaluationResult["status"];
  data?: Record<string, unknown>;
  pendingAction?: PolicyEvaluationResult["pendingAction"];
  denialReason?: string;
  latencyMs: number;
}

export interface KojoCodeModeResult {
  protocol: "kojo-connector-v1";
  mode: "code";
  status: "allowed" | "requires_confirmation" | "error";
  result: unknown;
  logs: string[];
  innerCalls: KojoCodeModeInnerCall[];
  pendingAction?: PolicyEvaluationResult["pendingAction"];
  error?: string;
  latencyMs: number;
}

function resolveWorkerScriptPath(): string {
  const selfDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(selfDir, "code-mode-worker.ts"),
    path.resolve(process.cwd(), "packages/agent/src/code-mode-worker.ts"),
    path.resolve(process.cwd(), "../../packages/agent/src/code-mode-worker.ts")
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("Kojo Code Mode worker entrypoint (code-mode-worker.ts) not found.");
}

function resolveBunExecutable(): string {
  const candidates = [
    process.env.KOJO_BUN_BIN,
    process.versions.bun ? process.execPath : undefined,
    path.join(os.homedir(), ".bun/bin/bun"),
    "/usr/local/bin/bun",
    "/opt/homebrew/bin/bun"
  ].filter((v): v is string => Boolean(v));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "bun";
}

type WorkerOutMsg =
  | { type: "call_tool"; id: string; toolName: string; args?: Record<string, unknown>; connectorSlug?: string }
  | { type: "done"; result: unknown; logs?: string[] }
  | { type: "error"; message?: string; logs?: string[] };

/**
 * Executes a multi-tool script inside an isolated child Bun process with an empty environment
 * (`env: {}`, zero host secrets/DB handles) and hard OS SIGKILL timeout. All tool invocations route
 * back over stdio IPC through parent Policy Engine and tenant external bridge enforcement.
 */
export async function executeKojoConnectorCode(params: {
  code: string;
  input?: Record<string, unknown>;
  ctx: ToolExecutionContext;
  options?: PolicyCheckOptions;
  maxCalls?: number;
  timeoutMs?: number;
}): Promise<KojoCodeModeResult> {
  if (!isCodeModeEnabled()) {
    throw new Error("Kojo Code Mode is available only in trusted development and test runtimes.");
  }
  const started = Date.now();
  const code = params.code.trim();
  if (!code) {
    throw new Error("Code Mode script cannot be empty.");
  }
  if (code.length > MAX_CODE_MODE_LENGTH) {
    throw new Error(`Code Mode script exceeds maximum length (${MAX_CODE_MODE_LENGTH} chars).`);
  }

  const maxCalls = Math.min(Math.max(params.maxCalls ?? DEFAULT_CODE_MODE_MAX_CALLS, 1), 25);
  const timeoutMs = Math.min(Math.max(params.timeoutMs ?? DEFAULT_CODE_MODE_TIMEOUT_MS, 50), 30_000);
  const registry = params.options?.registry ?? defaultMcpRegistry;

  // Prepare tenant-authorized tool catalog in the parent before spawning
  const allowedTools = await getAllowedToolsForUser(params.ctx.db, params.ctx.user, registry);
  const toolCatalog: Array<{ name: string; description?: string }> = allowedTools
    .filter((t) => t.name !== "execute_connector_code")
    .map((t) => ({ name: t.name, description: t.description }));

  const workerPath = resolveWorkerScriptPath();
  const bunBin = resolveBunExecutable();
  const innerCalls: KojoCodeModeInnerCall[] = [];

  return new Promise<KojoCodeModeResult>((resolve, reject) => {
    const child = spawn(bunBin, [workerPath], {
      cwd: os.tmpdir(),
      env: { NODE_ENV: process.env.NODE_ENV ?? "production" },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let settled = false;
    let totalStdoutBytes = 0;
    let stderrBuf = "";
    let lastInnerDenial: string | undefined;

    const cleanup = () => {
      clearTimeout(timer);
      rl.close();
      try {
        if (!child.killed) child.kill("SIGKILL");
      } catch {
        // Ignore already-exited child errors
      }
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const succeed = (res: KojoCodeModeResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(res);
    };

    const timer = setTimeout(() => {
      fail(new Error(`Kojo Code Mode execution timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    const writeToChild = (msg: unknown) => {
      if (!settled && child.stdin.writable) {
        child.stdin.write(`${JSON.stringify(msg)}\n`);
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      totalStdoutBytes += chunk.length;
      if (totalStdoutBytes > MAX_WORKER_STDOUT_BYTES) {
        fail(new Error(`Kojo Code Mode worker output exceeded ${MAX_WORKER_STDOUT_BYTES} bytes.`));
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBuf.length < 2048) {
        stderrBuf += chunk.toString("utf8");
      }
    });

    child.on("error", (err) => {
      fail(new Error(`Kojo Code Mode worker failed to start: ${err.message}`));
    });

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

    const handleToolRpc = async (
      msg: Extract<WorkerOutMsg, { type: "call_tool" }>
    ): Promise<void> => {
      if (settled) return;
      if (msg.toolName === "execute_connector_code") {
        writeToChild({
          type: "tool_result",
          id: msg.id,
          ok: false,
          error: "Nested execute_connector_code calls are not permitted."
        });
        return;
      }

      if (innerCalls.length >= maxCalls) {
        fail(new Error(`Kojo Code Mode tool call budget exceeded (max ${maxCalls}).`));
        return;
      }

      const rawArgs =
        msg.args && typeof msg.args === "object" && !Array.isArray(msg.args) ? msg.args : {};

      const policyRes = await executeToolWithPolicy(
        msg.toolName,
        rawArgs,
        params.ctx,
        params.options
      );

      innerCalls.push({
        toolName: msg.toolName,
        args: rawArgs,
        status: policyRes.status,
        data: policyRes.data,
        pendingAction: policyRes.pendingAction,
        denialReason: policyRes.denialReason,
        latencyMs: policyRes.latencyMs
      });

      if (policyRes.status === "requires_confirmation") {
        succeed({
          protocol: "kojo-connector-v1",
          mode: "code",
          status: "requires_confirmation",
          result: null,
          logs: [],
          innerCalls,
          pendingAction: policyRes.pendingAction,
          latencyMs: Date.now() - started
        });
        return;
      }

      if (policyRes.status === "denied" || policyRes.status === "error") {
        lastInnerDenial = policyRes.denialReason ?? `Tool '${msg.toolName}' denied.`;
        writeToChild({
          type: "tool_result",
          id: msg.id,
          ok: false,
          error: lastInnerDenial
        });
        return;
      }

      writeToChild({
        type: "tool_result",
        id: msg.id,
        ok: true,
        data: policyRes.data ?? {}
      });
    };

    rl.on("line", (line) => {
      if (settled || !line.trim()) return;
      let msg: WorkerOutMsg;
      try {
        msg = JSON.parse(line) as WorkerOutMsg;
      } catch {
        return;
      }

      if (msg.type === "call_tool") {
        void handleToolRpc(msg);
        return;
      }

      if (msg.type === "done") {
        succeed({
          protocol: "kojo-connector-v1",
          mode: "code",
          status: "allowed",
          result: msg.result ?? null,
          logs: Array.isArray(msg.logs) ? msg.logs : [],
          innerCalls,
          latencyMs: Date.now() - started
        });
        return;
      }

      if (msg.type === "error") {
        fail(new Error(msg.message || lastInnerDenial || "Code Mode execution error."));
      }
    });

    child.on("close", (exitCode) => {
      if (!settled) {
        fail(
          new Error(
            stderrBuf.trim() ||
              lastInnerDenial ||
              `Kojo Code Mode worker exited unexpectedly (${exitCode ?? "signal"}).`
          )
        );
      }
    });

    writeToChild({
      type: "init",
      code,
      input: params.input ?? {},
      toolCatalog
    });
  });
}
