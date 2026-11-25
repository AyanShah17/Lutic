import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";
import {
  buildAuthHeaders,
  isPrivateOrReservedIp,
  safePinnedHttpRequest
} from "./external-connectors";

const TCP_TIMEOUT_MS = 4000;
const LIVE_REST_SLUGS = new Set([
  "servicenow",
  "sap-pm",
  "sap-mm",
  "sap-pp",
  "sap-qm",
  "jira",
  "linear",
  "slack"
]);

function isPlaceholderHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower.endsWith(".local") ||
    lower.endsWith(".internal") ||
    lower.endsWith(".example") ||
    lower.endsWith(".example.com") ||
    lower.endsWith(".invalid")
  );
}

function getSlugPrefix(slug: string): string {
  for (const candidate of LIVE_REST_SLUGS) {
    if (slug === candidate || slug.startsWith(`${candidate}-`)) {
      return candidate;
    }
  }
  return slug;
}

async function resolveSafeTcpEndpoint(
  hostname: string
): Promise<{ address: string; family: 4 | 6 }> {
  const clean = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const allowPrivate =
    process.env.LUTIC_ALLOW_PRIVATE_CONNECTOR_URLS === "true" ||
    process.env.LUTIC_ALLOW_PRIVATE_OT_NETWORKS === "true";

  if (!allowPrivate && (clean === "localhost" || isPlaceholderHost(clean))) {
    throw new Error(`Blocked internal/placeholder OT host '${clean}'.`);
  }
  if (net.isIP(clean) !== 0) {
    if (!allowPrivate && isPrivateOrReservedIp(clean)) {
      throw new Error(`Blocked private OT IP address '${clean}'.`);
    }
    return { address: clean, family: (net.isIP(clean) || 4) as 4 | 6 };
  }
  const records = await dns.promises.lookup(clean, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new Error(`Unable to resolve OT host '${clean}'.`);
  }
  if (!allowPrivate) {
    for (const r of records) {
      if (isPrivateOrReservedIp(r.address)) {
        throw new Error(`Blocked private IP (${r.address}) for OT host '${clean}'.`);
      }
    }
  }
  const first = records[0]!;
  return { address: first.address, family: (net.isIP(first.address) || 4) as 4 | 6 };
}

export function getLiveProtocolKind(connector: {
  slug?: string;
  transport: string;
  endpointUrl: string;
}): "modbus" | "mqtt" | "rest" | null {
  if (connector.transport === "simulated") return null;
  const url = connector.endpointUrl.trim();
  const slug = getSlugPrefix(String(connector.slug ?? "").toLowerCase());
  if (/^modbus:\/\/[^/\s]+/i.test(url)) {
    try {
      const parsed = new URL(url);
      if (!isPlaceholderHost(parsed.hostname)) return "modbus";
    } catch {
      return null;
    }
  }
  if (/^mqtts?:\/\/[^/\s]+/i.test(url)) {
    try {
      const parsed = new URL(url);
      if (!isPlaceholderHost(parsed.hostname)) return "mqtt";
    } catch {
      return null;
    }
  }
  if (LIVE_REST_SLUGS.has(slug)) {
    try {
      const parsed = new URL(url);
      const allowHttp = process.env.LUTIC_ALLOW_PRIVATE_CONNECTOR_URLS === "true";
      const validProto =
        parsed.protocol === "https:" || (allowHttp && parsed.protocol === "http:");
      if (validProto && !isPlaceholderHost(parsed.hostname)) {
        return "rest";
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function hasLiveAdapterSupport(connector: {
  slug?: string;
  transport: string;
  endpointUrl: string;
}): boolean {
  return getLiveProtocolKind(connector) !== null;
}

// ---------- Binary Modbus TCP Wire Client ----------

async function modbusExchange(
  endpointUrl: string,
  unitId: number,
  functionCode: number,
  pduPayload: Buffer
): Promise<{ functionCode: number; data: Buffer; exceptionCode?: number }> {
  const parsed = new URL(endpointUrl);
  const port = parsed.port ? Number(parsed.port) : 502;
  const target = await resolveSafeTcpEndpoint(parsed.hostname);

  const txId = Math.floor(Math.random() * 0xffff);
  const pdu = Buffer.concat([Buffer.from([functionCode]), pduPayload]);
  const mbap = Buffer.alloc(7);
  mbap.writeUInt16BE(txId, 0);
  mbap.writeUInt16BE(0, 2); // Protocol ID = 0
  mbap.writeUInt16BE(1 + pdu.length, 4);
  mbap.writeUInt8(unitId & 0xff, 6);
  const frame = Buffer.concat([mbap, pdu]);

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: target.address,
      port,
      family: target.family
    });
    let rx = Buffer.alloc(0);
    let settled = false;
    const finish = (err?: Error, res?: { functionCode: number; data: Buffer; exceptionCode?: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(res!);
    };
    const timer = setTimeout(() => finish(new Error("Modbus TCP request timed out")), TCP_TIMEOUT_MS);
    socket.once("error", (err) => finish(err));
    socket.once("connect", () => socket.write(frame));
    socket.on("data", (chunk: Buffer) => {
      rx = Buffer.concat([rx, chunk]);
      if (rx.length < 7) return;
      const expectedLen = 6 + rx.readUInt16BE(4);
      if (rx.length < expectedLen) return;
      const rxFc = rx.readUInt8(7);
      if ((rxFc & 0x80) !== 0) {
        finish(undefined, {
          functionCode: rxFc & 0x7f,
          data: Buffer.alloc(0),
          exceptionCode: rx.length >= 9 ? rx.readUInt8(8) : 0
        });
        return;
      }
      finish(undefined, {
        functionCode: rxFc,
        data: rx.subarray(8, expectedLen)
      });
    });
  });
}

async function invokeModbusTool(
  endpointUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  creds?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const unitId = Number(args.unitId ?? creds?.unitId ?? 1) || 1;
  const address = Math.max(0, Math.min(65535, Number(args.address ?? 0) || 0));

  if (toolName === "modbus_write_coil") {
    const val = Boolean(args.value);
    const pdu = Buffer.alloc(4);
    pdu.writeUInt16BE(address, 0);
    pdu.writeUInt16BE(val ? 0xff00 : 0x0000, 2);
    const res = await modbusExchange(endpointUrl, unitId, 0x05, pdu);
    if (res.exceptionCode !== undefined) {
      throw new Error(`Modbus exception code ${res.exceptionCode}`);
    }
    return { protocol: "modbus-tcp", unitId, address, value: val, ok: true };
  }

  const fc = toolName === "modbus_read_input_registers" ? 0x04 : 0x03;
  const quantity = Math.max(1, Math.min(64, Number(args.quantity ?? args.count ?? 4) || 4));
  const pdu = Buffer.alloc(4);
  pdu.writeUInt16BE(address, 0);
  pdu.writeUInt16BE(quantity, 2);
  const res = await modbusExchange(endpointUrl, unitId, fc, pdu);
  if (res.exceptionCode !== undefined) {
    throw new Error(`Modbus exception code ${res.exceptionCode}`);
  }
  const byteCount = res.data.length > 0 ? res.data.readUInt8(0) : 0;
  const registers: number[] = [];
  for (let i = 1; i + 1 <= byteCount && i + 1 < res.data.length; i += 2) {
    registers.push(res.data.readUInt16BE(i));
  }
  return {
    protocol: "modbus-tcp",
    functionCode: fc,
    unitId,
    address,
    registers
  };
}

// ---------- Binary MQTT 3.1.1 Wire Client ----------

function encodeMqttString(s: string): Buffer {
  const strBuf = Buffer.from(s, "utf8");
  const len = Buffer.alloc(2);
  len.writeUInt16BE(strBuf.length, 0);
  return Buffer.concat([len, strBuf]);
}

function encodeMqttPacket(headerByte: number, payload: Buffer): Buffer {
  let x = payload.length;
  const remBytes: number[] = [];
  do {
    let encoded = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) encoded |= 0x80;
    remBytes.push(encoded);
  } while (x > 0);
  return Buffer.concat([Buffer.from([headerByte, ...remBytes]), payload]);
}

function tryReadMqttPacket(buf: Buffer): {
  type: number;
  flags: number;
  body: Buffer;
  consumed: number;
} | null {
  if (buf.length < 2) return null;
  let multiplier = 1;
  let value = 0;
  let idx = 1;
  let encodedByte = 0;
  do {
    if (idx >= buf.length) return null;
    encodedByte = buf.readUInt8(idx++);
    value += (encodedByte & 127) * multiplier;
    multiplier *= 128;
  } while ((encodedByte & 128) !== 0 && idx < 5);

  if (buf.length < idx + value) return null;
  const first = buf.readUInt8(0);
  return {
    type: first >> 4,
    flags: first & 0x0f,
    body: buf.subarray(idx, idx + value),
    consumed: idx + value
  };
}

async function mqttSessionExchange<T>(
  endpointUrl: string,
  creds: Record<string, unknown> | undefined,
  run: (
    send: (pkt: Buffer) => void,
    waitPacket: (expectedType: number, timeoutMs?: number) => Promise<Buffer>
  ) => Promise<T>
): Promise<T> {
  const parsed = new URL(endpointUrl);
  const useTls = parsed.protocol === "mqtts:";
  const port = parsed.port ? Number(parsed.port) : useTls ? 8883 : 1883;
  const target = await resolveSafeTcpEndpoint(parsed.hostname);

  const clientId = String(creds?.clientId ?? "lutic-ctrl").slice(0, 23);
  const username = typeof creds?.username === "string" ? creds.username : "";
  const password =
    (typeof creds?.password === "string" && creds.password) ||
    (typeof creds?.apiKey === "string" && creds.apiKey) ||
    "";
  let connectFlags = 0x02; // Clean Session
  if (username) connectFlags |= 0x80;
  if (password) connectFlags |= 0x40;

  const connectBodyParts: Buffer[] = [
    encodeMqttString("MQTT"),
    Buffer.from([0x04, connectFlags, 0x00, 15]), // 3.1.1, keepAlive=15s
    encodeMqttString(clientId)
  ];
  if (username) connectBodyParts.push(encodeMqttString(username));
  if (password) connectBodyParts.push(encodeMqttString(password));
  const connectPkt = encodeMqttPacket(0x10, Buffer.concat(connectBodyParts));

  const socket = useTls
    ? tls.connect({
        host: target.address,
        port,
        servername: parsed.hostname
      })
    : net.createConnection({
        host: target.address,
        port,
        family: target.family
      });

  let rx = Buffer.alloc(0);
  const inbox: Array<{ type: number; body: Buffer }> = [];
  const waiters: Array<{
    expectedType: number;
    resolve: (body: Buffer) => void;
    reject: (err: Error) => void;
  }> = [];

  const pumpPackets = () => {
    while (true) {
      const pkt = tryReadMqttPacket(rx);
      if (!pkt) break;
      rx = rx.subarray(pkt.consumed);
      const wIdx = waiters.findIndex((w) => w.expectedType === pkt.type);
      if (wIdx >= 0) {
        const w = waiters.splice(wIdx, 1)[0]!;
        w.resolve(pkt.body);
      } else {
        inbox.push({ type: pkt.type, body: pkt.body });
      }
    }
  };

  socket.on("data", (chunk: Buffer) => {
    rx = Buffer.concat([rx, chunk]);
    pumpPackets();
  });

  const waitPacket = (expectedType: number, timeoutMs = TCP_TIMEOUT_MS): Promise<Buffer> => {
    const queuedIdx = inbox.findIndex((p) => p.type === expectedType);
    if (queuedIdx >= 0) {
      return Promise.resolve(inbox.splice(queuedIdx, 1)[0]!.body);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.resolve === wrappedResolve);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error(`MQTT packet type ${expectedType} timed out`));
      }, timeoutMs);
      const wrappedResolve = (body: Buffer) => {
        clearTimeout(timer);
        resolve(body);
      };
      waiters.push({
        expectedType,
        resolve: wrappedResolve,
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
      pumpPackets();
    });
  };

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once(useTls ? "secureConnect" : "connect", () => resolve());
      socket.once("error", reject);
    });
    const connackPromise = waitPacket(2); // CONNACK
    socket.write(connectPkt);
    const connack = await connackPromise;
    if (connack.length < 2 || connack.readUInt8(1) !== 0) {
      throw new Error(`MQTT CONNACK refused (code ${connack.readUInt8(1) ?? -1})`);
    }
    const result = await run((pkt) => socket.write(pkt), waitPacket);
    socket.write(Buffer.from([0xe0, 0x00])); // DISCONNECT
    return result;
  } finally {
    socket.destroy();
  }
}

async function invokeMqttTool(
  endpointUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  creds?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const topic = String(args.topic ?? "#");
  return mqttSessionExchange(endpointUrl, creds, async (send, waitPacket) => {
    if (toolName === "mqtt_publish_payload") {
      const payloadStr =
        typeof args.payload === "string"
          ? args.payload
          : JSON.stringify(args.payload ?? {});
      const pkt = encodeMqttPacket(
        0x30,
        Buffer.concat([encodeMqttString(topic), Buffer.from(payloadStr, "utf8")])
      );
      send(pkt);
      return { protocol: "mqtt-3.1.1", published: true, topic, bytes: payloadStr.length };
    }

    const packetId = Buffer.alloc(2);
    packetId.writeUInt16BE(1, 0);
    const subPayload = Buffer.concat([packetId, encodeMqttString(topic), Buffer.from([0x00])]);
    const subackPromise = waitPacket(9); // SUBACK
    send(encodeMqttPacket(0x82, subPayload));
    await subackPromise;

    const messages: Array<{ topic: string; payload: string }> = [];
    const deadlineMs = Math.min(Math.max(Number(args.waitMs ?? 350), 100), 1500);
    const endAt = Date.now() + deadlineMs;
    while (Date.now() < endAt && messages.length < 10) {
      const remaining = endAt - Date.now();
      if (remaining <= 10) break;
      try {
        const pubBody = await waitPacket(3, remaining);
        if (pubBody.length >= 2) {
          const tLen = pubBody.readUInt16BE(0);
          const msgTopic = pubBody.subarray(2, 2 + tLen).toString("utf8");
          const msgBody = pubBody.subarray(2 + tLen).toString("utf8");
          messages.push({ topic: msgTopic, payload: msgBody });
        }
      } catch {
        break;
      }
    }
    return {
      protocol: "mqtt-3.1.1",
      topicFilter: topic,
      count: messages.length,
      messages
    };
  });
}

// ---------- Enterprise REST Adapters via Pinned-DNS HTTPS ----------

async function invokeRestAdapterTool(
  slug: string,
  endpointUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  creds?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const base = endpointUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...buildAuthHeaders(creds)
  };
  if (
    !headers["Authorization"] &&
    typeof creds?.username === "string" &&
    typeof creds?.password === "string"
  ) {
    headers["Authorization"] = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`;
  }

  let targetUrl = base;
  let method = "GET";
  let body: string | undefined;
  const kind = getSlugPrefix(slug);

  if (kind === "servicenow") {
    const limit = Math.min(Number(args.limit ?? 10) || 10, 50);
    if (toolName === "snow_create_incident") {
      targetUrl = `${base}/table/incident`;
      method = "POST";
      body = JSON.stringify(args);
    } else if (toolName === "snow_lookup_cmdb_ci") {
      targetUrl = `${base}/table/cmdb_ci?sysparm_limit=${limit}`;
    } else {
      targetUrl = `${base}/table/incident?sysparm_limit=${limit}`;
    }
  } else if (kind.startsWith("sap-")) {
    const query = args.$filter ? `&$filter=${encodeURIComponent(String(args.$filter))}` : "";
    if (toolName.includes("create") || toolName.includes("confirm") || toolName.includes("reserve")) {
      method = "POST";
      body = JSON.stringify(args);
      targetUrl = base;
    } else {
      targetUrl = `${base}${base.includes("?") ? "&" : "?"}$format=json&$top=${Math.min(Number(args.limit ?? 10) || 10, 50)}${query}`;
    }
  } else if (kind === "linear") {
    method = "POST";
    targetUrl = base;
    body = JSON.stringify({
      query:
        typeof args.query === "string"
          ? args.query
          : "{ issues(first: 10) { nodes { id identifier title state { name } } } }",
      variables: args.variables ?? {}
    });
  } else if (kind === "jira") {
    if (toolName.includes("search")) {
      const jql = typeof args.jql === "string" ? args.jql : "ORDER BY updated DESC";
      targetUrl = `${base}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${Math.min(Number(args.limit ?? 10) || 10, 50)}`;
    } else {
      targetUrl = `${base}/rest/api/3/project`;
    }
  } else if (kind === "slack") {
    if (toolName.includes("post") || toolName.includes("send")) {
      method = "POST";
      targetUrl = `${base}/chat.postMessage`;
      body = JSON.stringify(args);
    } else {
      targetUrl = `${base}/conversations.list?limit=${Math.min(Number(args.limit ?? 20) || 20, 100)}`;
    }
  }

  const res = await safePinnedHttpRequest(targetUrl, { method, headers, body });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Live ${kind} HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  }
  try {
    const parsed = JSON.parse(res.text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { data: parsed };
  } catch {
    return { text: res.text };
  }
}

export async function testLiveAdapter(
  connector: { slug: string; transport: string; endpointUrl: string },
  creds?: Record<string, unknown>
): Promise<{ healthy: boolean; message: string }> {
  const kind = getLiveProtocolKind(connector);
  if (!kind) {
    return { healthy: false, message: "No live protocol runtime configured for endpoint." };
  }
  if (kind === "modbus") {
    const pdu = Buffer.from([0x00, 0x00, 0x00, 0x01]);
    const res = await modbusExchange(
      connector.endpointUrl,
      Number(creds?.unitId ?? 1) || 1,
      0x03,
      pdu
    );
    const note =
      res.exceptionCode !== undefined
        ? `Modbus TCP connected (exception ${res.exceptionCode})`
        : `Modbus TCP connected (${res.data.length} bytes)`;
    return { healthy: true, message: note };
  }
  if (kind === "mqtt") {
    await mqttSessionExchange(connector.endpointUrl, creds, async (send, waitPacket) => {
      const pong = waitPacket(13, 2500); // PINGRESP
      send(Buffer.from([0xc0, 0x00])); // PINGREQ
      await pong;
    });
    return { healthy: true, message: "MQTT 3.1.1 broker CONNACK & PINGRESP verified." };
  }
  await invokeRestAdapterTool(
    connector.slug,
    connector.endpointUrl,
    "health_probe",
    { limit: 1 },
    creds
  );
  return { healthy: true, message: `Live HTTPS ${connector.slug} endpoint responded.` };
}

export async function invokeLiveAdapterTool(
  connector: { slug: string; transport: string; endpointUrl: string },
  toolName: string,
  args: Record<string, unknown>,
  creds?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const kind = getLiveProtocolKind(connector);
  if (kind === "modbus") {
    return invokeModbusTool(connector.endpointUrl, toolName, args, creds);
  }
  if (kind === "mqtt") {
    return invokeMqttTool(connector.endpointUrl, toolName, args, creds);
  }
  if (kind === "rest") {
    return invokeRestAdapterTool(connector.slug, connector.endpointUrl, toolName, args, creds);
  }
  throw new Error(`No live adapter implementation for '${connector.slug}'.`);
}
