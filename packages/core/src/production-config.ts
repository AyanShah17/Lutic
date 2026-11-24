const knownSecrets = new Set([
  "lutic_dev_password",
  "lutic-demo-password",
  "lutic-local-dev-session-secret-2026-keep-private",
  "dev-auth-secret-change-in-production-32chars",
  "lutic-change-this-secret-in-production-32chars",
  "lutic-replace-with-32-plus-char-random-secret",
  "lutic-dev-license-signing-secret-2026",
  "license-server-dev-admin-token",
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
]);

export function requireDeploymentSecret(name: string, value: string | undefined, minimum: number): string {
  if (!value || value.trim() !== value || value.length < minimum ||
      new Set(value).size < 8 || knownSecrets.has(value.toLowerCase())) {
    throw new Error(`${name} requires a unique secret of at least ${minimum} characters`);
  }
  return value;
}

export function requireCredentialKey(
  value: string | undefined,
  name = "CREDENTIAL_ENCRYPTION_KEY"
): string {
  const key = requireDeploymentSecret(name, value, 64);
  if (!/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error(`${name} must be a 64-character hexadecimal key`);
  }
  return key;
}

export function requireProductionDatabaseUrl(value: string | undefined): string {
  try {
    const url = new URL(value ?? "");
    if (["postgres:", "postgresql:"].includes(url.protocol) && url.hostname && url.pathname.length > 1 &&
        !knownSecrets.has(decodeURIComponent(url.password).toLowerCase()) &&
        !knownSecrets.has(url.searchParams.get("password")?.toLowerCase() ?? "")) {
      return url.href;
    }
  } catch {
    // Keep malformed input out of connection error output.
  }
  throw new Error("DATABASE_URL requires a PostgreSQL connection URL with production credentials");
}

export function requireProductionLicenseUrl(value: string | undefined): string {
  try {
    const url = new URL(value ?? "");
    if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash) {
      return url.href.replace(/\/+$/, "");
    }
  } catch {
    // Keep malformed input out of issuer error output.
  }
  throw new Error("LICENSE_SERVER_URL requires an HTTPS license issuer URL");
}

export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  requireProductionDatabaseUrl(env.DATABASE_URL);
  requireDeploymentSecret("AUTH_SECRET", env.AUTH_SECRET, 32);
  if (env.AUTH_SECRET_PREVIOUS?.trim()) {
    for (const entry of env.AUTH_SECRET_PREVIOUS.split(",").map((s) => s.trim()).filter(Boolean)) {
      requireDeploymentSecret("AUTH_SECRET_PREVIOUS", entry, 32);
      if (entry === env.AUTH_SECRET) {
        throw new Error("AUTH_SECRET_PREVIOUS must not duplicate AUTH_SECRET");
      }
    }
  }
  requireCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
  if (env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS?.trim()) {
    const activeKeyLower = env.CREDENTIAL_ENCRYPTION_KEY?.toLowerCase();
    for (const entry of env.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS.split(",").map((s) => s.trim()).filter(Boolean)) {
      requireCredentialKey(entry, "CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS");
      if (activeKeyLower && entry.toLowerCase() === activeKeyLower) {
        throw new Error("CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS must not duplicate CREDENTIAL_ENCRYPTION_KEY");
      }
    }
  }
  if (env.LICENSE_ENFORCE && !["true", "false"].includes(env.LICENSE_ENFORCE)) {
    throw new Error("LICENSE_ENFORCE must be true or false");
  }
  if (env.LICENSE_ENFORCE === "true") {
    requireProductionLicenseUrl(env.LICENSE_SERVER_URL);
    requireDeploymentSecret("LICENSE_SIGNING_SECRET", env.LICENSE_SIGNING_SECRET, 32);
    if (!env.LUTIC_LICENSE_KEY?.trim() || /^LUTIC-(DEV-VALID|PRO-VALID|EXP-0000|REV-0000)-/i.test(env.LUTIC_LICENSE_KEY)) {
      throw new Error("LUTIC_LICENSE_KEY requires an issued production license");
    }
  }
}
