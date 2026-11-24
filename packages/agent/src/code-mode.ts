import type { ToolExecutionContext } from "@kojo/connectors";
import type { PolicyCheckOptions, PolicyEvaluationResult } from "./policy";

export const MAX_CODE_MODE_LENGTH = 4000;
export const DEFAULT_CODE_MODE_MAX_CALLS = 8;
export const DEFAULT_CODE_MODE_TIMEOUT_MS = 5000;

export const CODE_MODE_CONTAINED_MESSAGE =
  "Kojo Code Mode supplied-script execution is disabled pending isolated worker sandbox containment (P0-07). Use standard governed tool calls instead.";

export class CodeModeContainedError extends Error {
  public readonly statusCode = 501;
  public readonly code = "CODE_MODE_DISABLED";

  constructor(message = CODE_MODE_CONTAINED_MESSAGE) {
    super(message);
    this.name = "CodeModeContainedError";
  }
}

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

/**
 * Contained P0-07 server boundary: supplied scripts are never evaluated inside the host process.
 */
export async function executeKojoConnectorCode(_params: {
  code: string;
  input?: Record<string, unknown>;
  ctx: ToolExecutionContext;
  options?: PolicyCheckOptions;
  maxCalls?: number;
  timeoutMs?: number;
}): Promise<KojoCodeModeResult> {
  throw new CodeModeContainedError();
}
