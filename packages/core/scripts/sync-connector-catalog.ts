import fs from "node:fs";
import path from "node:path";

interface GeneratedCatalogEntry {
  slug: string;
  name: string;
  category: "mcp" | "http" | "scada" | "erp" | "messaging" | "custom";
  transport: "simulated";
  description: string;
  defaultTools: Array<{ name: string; description: string }>;
  credentialFields: Array<{ key: string; label: string; secret?: boolean; defaultValue?: string }>;
}

const DEFAULT_OC_DIR = "/Users/ayanshah/Downloads/open-connector-main/src/providers";
const DEFAULT_MET_DIR = "/Users/ayanshah/Downloads/metorial-main/integrations";
const OUT_PATH = path.resolve(import.meta.dir, "../src/connector-catalog.generated.json");

const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\uFE0F]/gu;
const BANNED_VENDOR_RE =
  /(clamav|clamd|litellm|metorial|openconnectors|open-connector|openconnector|slates|pglite|\butcp\b)/gi;
const HAS_BANNED_VENDOR_RE =
  /\b(clamav|clamd|litellm|metorial|openconnectors|open-connector|openconnector|slates|pglite|utcp)\b/i;

// Pre-seeded canonical IDs for built-in core/enterprise/OT connectors + internal names to exclude.
const RESERVED_CANON = new Set([
  "cmms",
  "historian",
  "mes",
  "partserp",
  "docs",
  "http",
  "luticcloud",
  "luticbridge",
  "luticapi",
  "sappm",
  "sapmm",
  "sappp",
  "sapqm",
  "awsiot",
  "awss3",
  "awscloudwatch",
  "servicenow",
  "mqttbroker",
  "mqtt",
  "opcua",
  "modbustcp",
  "modbus",
  "metorial",
  "openconnector",
  "openconnectors",
  "litellm",
  "clamav",
  "clamd",
  "pglite",
  "utcp",
  "slates"
]);

function canonKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^@[^/]+\//, "")
    .replace(/[^a-z0-9]+/g, "");
}

function toSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^@[^/]+\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function sanitizeText(input: string, maxLen = 150): string {
  let out = input
    .replace(EMOJI_RE, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_#]/g, "")
    .replace(BANNED_VENDOR_RE, "Lutic")
    .replace(/\bMagic MCP\b/gi, "Lutic Cloud")
    .replace(/\bStreamable HTTP MCP\b/gi, "HTTPS")
    .replace(/\bMCP server(s)?\b/gi, "Lutic connector$1")
    .replace(/\bMCP tool(s)?\b/gi, "Lutic tool$1")
    .replace(/\bMCP\b/g, "Lutic")
    .replace(/\s+/g, " ")
    .trim();
  if (out.length > maxLen) {
    out = `${out.slice(0, maxLen - 3).trimEnd()}...`;
  }
  return out;
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function mapCategory(rawCategories: string[]): GeneratedCatalogEntry["category"] {
  const joined = rawCategories.join(" ").toLowerCase();
  if (/(messaging|chat|email|communication|support|social|ticketing|itsm|notification)/.test(joined)) {
    return "messaging";
  }
  if (/(erp|finance|accounting|billing|commerce|payment|hr|crm|sales|inventory|payroll)/.test(joined)) {
    return "erp";
  }
  if (/(iot|device|hardware|industrial|telemetry|fleet|manufacturing|scada)/.test(joined)) {
    return "scada";
  }
  return "http";
}

function parseOcProvider(dirPath: string, folderName: string): {
  canon: string;
  slug: string;
  name: string;
  category: GeneratedCatalogEntry["category"];
  description: string;
  endpointUrl: string;
  authLabel: string;
  tools: Array<{ name: string; description: string }>;
} | null {
  const defPath = path.join(dirPath, "definition.ts");
  if (!fs.existsSync(defPath)) return null;
  const defSrc = fs.readFileSync(defPath, "utf8");

  const service = /service\s*:\s*["']([^"']+)["']/.exec(defSrc)?.[1] ?? folderName;
  const displayName = /displayName\s*:\s*["']([^"']+)["']/.exec(defSrc)?.[1] ?? titleFromSlug(toSlug(service));
  const catsRaw = /categories\s*:\s*\[([^\]]*)\]/.exec(defSrc)?.[1] ?? "";
  const categories = [...catsRaw.matchAll(/["']([^"']+)["']/g)].map((m) => m[1] ?? "");
  const homepageUrl = /homepageUrl\s*:\s*["']([^"']+)["']/.exec(defSrc)?.[1] ?? "";
  const authLabel = /label\s*:\s*["']([^"']+)["']/.exec(defSrc)?.[1] ?? "API Key / Access Token";
  const authDesc = /description\s*:\s*["']([^"']+)["']/.exec(defSrc)?.[1] ?? "";

  const actionsPath = path.join(dirPath, "actions.ts");
  const tools: Array<{ name: string; description: string }> = [];
  const seenTool = new Set<string>();
  if (fs.existsSync(actionsPath)) {
    const actSrc = fs.readFileSync(actionsPath, "utf8");
    for (const m of actSrc.matchAll(
      /(?:action|defineAction)\s*\(\s*["']([a-z0-9_:-]+)["']\s*,\s*["'][^"']*["']\s*,\s*["']([^"']+)["']/gi
    )) {
      const tName = m[1] ?? "";
      if (tName && !seenTool.has(tName)) {
        seenTool.add(tName);
        tools.push({ name: tName, description: sanitizeText(m[2] ?? "", 80) });
      }
      if (tools.length >= 4) break;
    }
    if (tools.length < 4) {
      for (const m of actSrc.matchAll(
        /name\s*:\s*["']([a-z0-9_:-]+)["'][\s\S]{0,160}?description\s*:\s*["']([^"']+)["']/gi
      )) {
        const tName = m[1] ?? "";
        if (tName && !seenTool.has(tName)) {
          seenTool.add(tName);
          tools.push({ name: tName, description: sanitizeText(m[2] ?? "", 80) });
        }
        if (tools.length >= 4) break;
      }
    }
  }

  const cleanName = sanitizeText(displayName, 60) || titleFromSlug(toSlug(folderName));
  const slug = toSlug(service || folderName);
  const rawDesc = authDesc || `Connect ${cleanName} data, operations, and workflows with Lutic.`;
  return {
    canon: canonKey(service || folderName),
    slug,
    name: cleanName,
    category: mapCategory(categories),
    description: sanitizeText(rawDesc, 150) || `Managed ${cleanName} connector for Lutic workflows and AI agents.`,
    endpointUrl: homepageUrl && /^https?:\/\//.test(homepageUrl) ? homepageUrl : `https://api.${slug}.com`,
    authLabel: sanitizeText(authLabel, 48) || "API Key / Access Token",
    tools
  };
}

function parseMetorialIntegration(dirPath: string, folderName: string): {
  canon: string;
  slug: string;
  name: string;
  category: GeneratedCatalogEntry["category"];
  description: string;
  endpointUrl: string;
  authLabel: string;
  tools: Array<{ name: string; description: string }>;
} | null {
  const slatePath = path.join(dirPath, "slate.json");
  const specPath = path.join(dirPath, "src", "spec.ts");
  if (!fs.existsSync(slatePath) && !fs.existsSync(specPath)) return null;

  let slateDesc = "";
  let slateCats: string[] = [];
  if (fs.existsSync(slatePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(slatePath, "utf8")) as {
        description?: string;
        categories?: string[];
      };
      slateDesc = parsed.description ?? "";
      slateCats = Array.isArray(parsed.categories) ? parsed.categories : [];
    } catch {
      // ignore invalid json
    }
  }

  let specName = "";
  let specDesc = "";
  if (fs.existsSync(specPath)) {
    const specSrc = fs.readFileSync(specPath, "utf8");
    specName = /name\s*:\s*['"]([^'"]+)['"]/.exec(specSrc)?.[1] ?? "";
    specDesc = /description\s*:\s*['"]([^'"]+)['"]/.exec(specSrc)?.[1] ?? "";
  }

  const tools: Array<{ name: string; description: string }> = [];
  const toolsDir = path.join(dirPath, "src", "tools");
  if (fs.existsSync(toolsDir)) {
    const files = fs
      .readdirSync(toolsDir)
      .filter((f) => f.endsWith(".ts") && f !== "index.ts")
      .sort()
      .slice(0, 4);
    for (const file of files) {
      const toolSlug = file.replace(/\.ts$/, "");
      tools.push({
        name: toolSlug.replace(/-/g, "_"),
        description: sanitizeText(titleFromSlug(toolSlug), 80)
      });
    }
  }

  const slug = toSlug(folderName);
  const cleanName = sanitizeText(specName || titleFromSlug(slug), 60) || titleFromSlug(slug);
  const rawDesc = slateDesc || specDesc || `Managed ${cleanName} connector for Lutic workflows and AI agents.`;

  return {
    canon: canonKey(folderName),
    slug,
    name: cleanName,
    category: mapCategory(slateCats),
    description: sanitizeText(rawDesc, 150),
    endpointUrl: `https://api.${slug}.com`,
    authLabel: "API Key / Bearer Token",
    tools
  };
}

function run() {
  const ocDir = process.env.OC_PROVIDERS_DIR || DEFAULT_OC_DIR;
  const metDir = process.env.METORIAL_INTEGRATIONS_DIR || DEFAULT_MET_DIR;
  if (!fs.existsSync(ocDir) || !fs.existsSync(metDir)) {
    throw new Error(`Missing source directories: ${ocDir} / ${metDir}`);
  }

  const seenCanon = new Set<string>(RESERVED_CANON);
  const usedSlugs = new Set<string>([
    "cmms", "historian", "mes", "parts-erp", "docs", "http",
    "lutic-cloud", "lutic-bridge", "lutic-api",
    "sap-pm", "sap-mm", "sap-pp", "sap-qm",
    "aws-iot", "aws-s3", "aws-cloudwatch",
    "servicenow", "mqtt-broker", "opc-ua", "modbus-tcp"
  ]);

  const byCanon = new Map<string, GeneratedCatalogEntry>();
  let ocTotal = 0;
  let metTotal = 0;
  let skippedOverlap = 0;
  let skippedReserved = 0;

  const ocFolders = fs
    .readdirSync(ocDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const folder of ocFolders) {
    const parsed = parseOcProvider(path.join(ocDir, folder), folder);
    if (!parsed || !parsed.slug) continue;
    ocTotal++;
    if (seenCanon.has(parsed.canon) || usedSlugs.has(parsed.slug) || HAS_BANNED_VENDOR_RE.test(parsed.slug)) {
      skippedReserved++;
      continue;
    }
    seenCanon.add(parsed.canon);
    usedSlugs.add(parsed.slug);
    const fallbackTool = `${parsed.slug.replace(/-/g, "_")}_execute`;
    byCanon.set(parsed.canon, {
      slug: parsed.slug,
      name: parsed.name,
      category: parsed.category,
      transport: "simulated",
      description: parsed.description,
      defaultTools:
        parsed.tools.length > 0
          ? parsed.tools
          : [{ name: fallbackTool, description: sanitizeText(`Run ${parsed.name} operation`, 80) }],
      credentialFields: [
        { key: "endpointUrl", label: sanitizeText(`${parsed.name} Endpoint`, 64), defaultValue: parsed.endpointUrl.replace(BANNED_VENDOR_RE, "lutic") },
        { key: "apiKey", label: parsed.authLabel, secret: true }
      ]
    });
  }

  const metFolders = fs
    .readdirSync(metDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const folder of metFolders) {
    const parsed = parseMetorialIntegration(path.join(metDir, folder), folder);
    if (!parsed || !parsed.slug) continue;
    metTotal++;
    if (seenCanon.has(parsed.canon)) {
      // Skip duplicate: preserve distinct entry, optionally enrich if empty
      const existing = byCanon.get(parsed.canon);
      if (existing && parsed.tools.length > 0 && existing.defaultTools[0]?.name.endsWith("_execute")) {
        existing.defaultTools = parsed.tools;
      }
      skippedOverlap++;
      continue;
    }
    if (usedSlugs.has(parsed.slug) || HAS_BANNED_VENDOR_RE.test(parsed.slug)) {
      skippedReserved++;
      continue;
    }
    seenCanon.add(parsed.canon);
    usedSlugs.add(parsed.slug);
    const fallbackTool = `${parsed.slug.replace(/-/g, "_")}_execute`;
    byCanon.set(parsed.canon, {
      slug: parsed.slug,
      name: parsed.name,
      category: parsed.category,
      transport: "simulated",
      description: parsed.description,
      defaultTools:
        parsed.tools.length > 0
          ? parsed.tools
          : [{ name: fallbackTool, description: sanitizeText(`Run ${parsed.name} operation`, 80) }],
      credentialFields: [
        { key: "endpointUrl", label: sanitizeText(`${parsed.name} Endpoint`, 64), defaultValue: parsed.endpointUrl.replace(BANNED_VENDOR_RE, "lutic") },
        { key: "apiKey", label: parsed.authLabel, secret: true }
      ]
    });
  }

  const entries = Array.from(byCanon.values()).sort((a, b) => a.slug.localeCompare(b.slug));
  const jsonText = JSON.stringify(entries);

  if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\uFE0F]/u.test(jsonText)) {
    throw new Error("Emoji/dingbat detected in generated connector catalog!");
  }
  const bannedMatch = /\b(clamav|clamd|litellm|metorial|openconnectors|open-connector|openconnector|pglite|utcp)\b/i.exec(
    jsonText
  );
  if (bannedMatch) {
    throw new Error(`Banned white-label term detected: ${bannedMatch[0]}`);
  }

  fs.writeFileSync(OUT_PATH, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ocTotal,
        metTotal,
        skippedReserved,
        skippedOverlap,
        distinctGenerated: entries.length,
        sizeKb: Math.round(Buffer.byteLength(jsonText, "utf8") / 1024)
      },
      null,
      2
    )
  );
}

run();
