import readline from "node:readline";

interface InitMessage {
  type: "init";
  code: string;
  input: Record<string, unknown>;
  toolCatalog: Array<{ name: string; description?: string }>;
}

interface ToolResultMessage {
  type: "tool_result";
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

const pending = new Map<
  string,
  { resolve: (val: unknown) => void; reject: (err: Error) => void }
>();
const logs: string[] = [];
let callSeq = 0;

function writeLine(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function pushLog(level: string, args: unknown[]): void {
  if (logs.length >= 50) return;
  const formatted = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ")
    .slice(0, 512);
  logs.push(level === "log" ? formatted : `[${level}] ${formatted}`);
}

function sendToolCall(
  toolName: string,
  args: Record<string, unknown> = {},
  connectorSlug?: string
): Promise<unknown> {
  const id = `rpc-${++callSeq}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    writeLine({
      type: "call_tool",
      id,
      toolName,
      args: args && typeof args === "object" ? args : {},
      ...(connectorSlug ? { connectorSlug } : {})
    });
  });
}

function finish(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`, () => {
    process.exit(0);
  });
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let started = false;

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg: InitMessage | ToolResultMessage;
  try {
    msg = JSON.parse(line) as InitMessage | ToolResultMessage;
  } catch {
    return;
  }

  if (msg.type === "tool_result") {
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.data);
    else entry.reject(new Error(msg.error ?? "Tool call denied or failed."));
    return;
  }

  if (msg.type === "init" && !started) {
    started = true;
    void (async () => {
      try {
        const lutic = {
          input: msg.input ?? {},
          listTools: () => msg.toolCatalog ?? [],
          callTool: (toolName: string, args: Record<string, unknown> = {}) =>
            sendToolCall(String(toolName), args),
          tools: new Proxy<Record<string, (args?: Record<string, unknown>) => Promise<unknown>>>(
            {},
            {
              get: (_target, prop) => (args: Record<string, unknown> = {}) =>
                sendToolCall(String(prop), args)
            }
          ),
          connectors: new Proxy<
            Record<string, Record<string, (args?: Record<string, unknown>) => Promise<unknown>>>
          >(
            {},
            {
              get: (_target, slugProp) =>
                new Proxy<Record<string, (args?: Record<string, unknown>) => Promise<unknown>>>(
                  {},
                  {
                    get: (_t2, toolProp) => (args: Record<string, unknown> = {}) =>
                      sendToolCall(String(toolProp), args, String(slugProp))
                  }
                )
            }
          )
        };

        const workerConsole = {
          log: (...args: unknown[]) => pushLog("log", args),
          info: (...args: unknown[]) => pushLog("info", args),
          warn: (...args: unknown[]) => pushLog("warn", args),
          error: (...args: unknown[]) => pushLog("error", args)
        };

        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
          ...args: string[]
        ) => (luticArg: unknown, inputArg: unknown, consoleArg: unknown) => Promise<unknown>;

        const runner = new AsyncFunction("lutic", "input", "console", msg.code);
        const result = await runner(lutic, msg.input ?? {}, workerConsole);
        finish({ type: "done", result: result === undefined ? null : result, logs });
      } catch (err) {
        finish({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
          logs
        });
      }
    })();
  }
});
