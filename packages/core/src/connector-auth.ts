import crypto from "node:crypto";
import { safePinnedHttpRequest } from "./external-connectors";

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256"
  };
}

export function buildOAuthAuthorizationUrl(params: {
  authorizationUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
  codeChallenge: string;
}): string {
  const url = new URL(params.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (params.scopes.length > 0) {
    url.searchParams.set("scope", params.scopes.join(" "));
  }
  return url.toString();
}

export interface OAuthTokenResult {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  expiresAt?: string;
}

export async function exchangeOAuthCodeForTokens(params: {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokenResult> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier
  });
  if (params.clientSecret) {
    form.set("client_secret", params.clientSecret);
  }

  const res = await safePinnedHttpRequest(params.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`OAuth token exchange failed (${res.status}): ${res.text.slice(0, 200)}`);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(res.text) as Record<string, unknown>;
  } catch {
    const parsedParams = new URLSearchParams(res.text);
    data = Object.fromEntries(parsedParams.entries());
  }

  const accessToken = typeof data.access_token === "string" ? data.access_token.trim() : "";
  if (!accessToken) {
    const errDesc =
      typeof data.error_description === "string"
        ? data.error_description
        : typeof data.error === "string"
          ? data.error
          : "Missing access_token";
    throw new Error(`OAuth token exchange returned no access token: ${errDesc}`);
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : Number(data.expires_in);
  const expiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : undefined;

  return {
    accessToken,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    tokenType: typeof data.token_type === "string" ? data.token_type : "Bearer",
    scope: typeof data.scope === "string" ? data.scope : undefined,
    expiresAt
  };
}

export async function refreshOAuthCredentialsIfExpired(
  creds?: Record<string, unknown>
): Promise<{ creds?: Record<string, unknown>; refreshed: boolean }> {
  if (!creds || creds.authScheme !== "oauth2") {
    return { creds, refreshed: false };
  }
  const expiresAtRaw = typeof creds.expiresAt === "string" ? creds.expiresAt : "";
  const refreshToken = typeof creds.refreshToken === "string" ? creds.refreshToken : "";
  const tokenUrl = typeof creds.tokenUrl === "string" ? creds.tokenUrl : "";
  const clientId = typeof creds.clientId === "string" ? creds.clientId : "";

  if (!expiresAtRaw || !refreshToken || !tokenUrl || !clientId) {
    return { creds, refreshed: false };
  }
  const expMs = Date.parse(expiresAtRaw);
  if (!Number.isFinite(expMs) || expMs - Date.now() > 60_000) {
    return { creds, refreshed: false };
  }

  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId
  });
  if (typeof creds.clientSecret === "string" && creds.clientSecret) {
    form.set("client_secret", creds.clientSecret);
  }

  const res = await safePinnedHttpRequest(tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`OAuth token refresh failed (${res.status}): ${res.text.slice(0, 200)}`);
  }

  const data = JSON.parse(res.text) as Record<string, unknown>;
  const accessToken = typeof data.access_token === "string" ? data.access_token.trim() : "";
  if (!accessToken) {
    throw new Error("OAuth token refresh response missing access_token");
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : Number(data.expires_in);
  const nextExpiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : expiresAtRaw;

  return {
    refreshed: true,
    creds: {
      ...creds,
      accessToken,
      refreshToken:
        typeof data.refresh_token === "string" && data.refresh_token
          ? data.refresh_token
          : refreshToken,
      expiresAt: nextExpiresAt
    }
  };
}
