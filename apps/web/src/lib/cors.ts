const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "http://localhost:19006",
  "http://127.0.0.1:19006",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

function getConfiguredOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? "";
  const extra = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const configured = extra.filter((origin) => {
    try {
      const parsed = new URL(origin);
      return parsed.origin === origin &&
        (parsed.protocol === "https:" || process.env.NODE_ENV !== "production");
    } catch { return false; }
  });
  return process.env.NODE_ENV === "production" ? configured : [...DEFAULT_ALLOWED_ORIGINS, ...configured];
}

export function resolveCorsOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const allowed = getConfiguredOrigins();
  return allowed.includes(origin) ? origin : null;
}

export function buildCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = resolveCorsOrigin(origin);
  if (!allowed) return {};
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
  if (allowed !== "*") {
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}
