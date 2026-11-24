import net from "node:net";

const EICAR = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");

export class UploadScanUnavailableError extends Error {
  constructor() {
    super("Upload scanner unavailable. Please try again later.");
    this.name = "UploadScanUnavailableError";
  }
}

/** clamd INSTREAM protocol: https://docs.clamav.net/manual/Usage/ClamdProtocol.html */
export async function scanUploadForViruses(
  buffer: Buffer,
  _filename: string
): Promise<{ clean: boolean; threat?: string }> {
  if (buffer.includes(EICAR)) return { clean: false, threat: "EICAR-Test-Signature" };
  const host = process.env.CLAMAV_HOST;
  if (!host) {
    if (process.env.NODE_ENV === "production") throw new UploadScanUnavailableError();
    // shortcut: development only checks EICAR, configure clamd for actual malware scanning.
    return { clean: true };
  }
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UploadScanUnavailableError();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let response = "";
    let settled = false;
    const finish = (result?: { clean: boolean; threat?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      if (result) resolve(result);
      else reject(new UploadScanUnavailableError());
    };
    // A total deadline also covers a scanner that keeps sending incomplete replies.
    const deadline = setTimeout(() => finish(), 15_000);
    socket.once("error", () => finish());
    socket.once("close", () => finish());
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > 4096) return finish();
      const terminator = response.indexOf("\0");
      if (terminator < 0) return;
      const verdict = response.slice(0, terminator);
      if (verdict === "stream: OK") return finish({ clean: true });
      const threat = /^stream: (.+) FOUND$/.exec(verdict)?.[1];
      finish(threat ? { clean: false, threat } : undefined);
    });
    socket.once("connect", () => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(buffer.length);
      socket.write("zINSTREAM\0");
      socket.write(length);
      socket.write(buffer);
      socket.write(Buffer.alloc(4));
    });
  });
}

export interface ScannerHealthStatus {
  status: "ready" | "unconfigured" | "unavailable";
  host?: string;
  port?: number;
  version?: string;
  latencyMs?: number;
  detail?: string;
}

export async function checkScannerHealth(): Promise<ScannerHealthStatus> {
  const host = process.env.CLAMAV_HOST?.trim();
  if (!host) {
    return {
      status: "unconfigured",
      detail: process.env.NODE_ENV === "production"
        ? "CLAMAV_HOST is not configured; production uploads fail closed."
        : "Development mode uses EICAR signature check only."
    };
  }
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { status: "unavailable", host, detail: "Invalid CLAMAV_PORT" };
  }
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let response = "";
    let settled = false;
    const finish = (res: ScannerHealthStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(res);
    };
    const timer = setTimeout(
      () => finish({ status: "unavailable", host, port, detail: "Scanner health check timed out" }),
      3000
    );
    socket.once("error", (err) =>
      finish({ status: "unavailable", host, port, detail: err.message })
    );
    socket.once("close", () => {
      if (!settled) {
        finish({ status: "unavailable", host, port, detail: "Scanner closed connection early" });
      }
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > 512) {
        finish({ status: "unavailable", host, port, detail: "Oversized scanner response" });
        return;
      }
      const term = response.indexOf("\0");
      if (term < 0) return;
      const version = response.slice(0, term).trim();
      if (version.startsWith("ClamAV ") || version === "PONG") {
        finish({
          status: "ready",
          host,
          port,
          version,
          latencyMs: Math.max(1, Date.now() - started)
        });
      } else {
        finish({ status: "unavailable", host, port, detail: `Unexpected reply: ${version}` });
      }
    });
    socket.once("connect", () => {
      socket.write("zVERSION\0");
    });
  });
}
