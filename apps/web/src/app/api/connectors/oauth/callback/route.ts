import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  auditLog,
  authorize,
  CONNECTOR_CATALOG,
  CONNECTOR_OAUTH_COOKIE,
  connectorConnections,
  connectorSyncLogs,
  decryptCredentials,
  encryptCredentials,
  exchangeOAuthCodeForTokens
} from "@lutic/core";
import { getSessionUser, problemResponse } from "@/lib/auth";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";

function parseCookieValue(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function redirectToConnectors(req: Request, query: string): NextResponse {
  const url = new URL(`/connectors${query}`, req.url);
  const res = NextResponse.redirect(url);
  res.cookies.set(CONNECTOR_OAUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "connector:write", { tenantId: user.tenantId });

    const url = new URL(req.url);
    const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
    if (oauthError) {
      return redirectToConnectors(req, `?oauth_error=${encodeURIComponent(oauthError)}`);
    }

    const code = url.searchParams.get("code")?.trim() ?? "";
    const state = url.searchParams.get("state")?.trim() ?? "";
    const rawCookie = parseCookieValue(req, CONNECTOR_OAUTH_COOKIE);
    if (!rawCookie || !code || !state) {
      return redirectToConnectors(
        req,
        `?oauth_error=${encodeURIComponent("Invalid or missing OAuth callback state.")}`
      );
    }

    let pending: Record<string, unknown>;
    try {
      pending = decryptCredentials(rawCookie);
    } catch {
      return redirectToConnectors(
        req,
        `?oauth_error=${encodeURIComponent("Expired or invalid OAuth state cookie.")}`
      );
    }

    if (
      pending.state !== state ||
      pending.tenantId !== user.tenantId ||
      pending.userId !== user.userId ||
      typeof pending.exp !== "number" ||
      Date.now() > pending.exp
    ) {
      return redirectToConnectors(
        req,
        `?oauth_error=${encodeURIComponent("OAuth state verification failed.")}`
      );
    }

    const slug = String(pending.slug || "custom");
    const name = String(pending.name || slug);
    const category = (String(pending.category || "http") as
      | "mcp"
      | "http"
      | "scada"
      | "erp"
      | "messaging"
      | "custom");
    const endpointUrl = String(pending.endpointUrl || "");
    const tokenSet = await exchangeOAuthCodeForTokens({
      tokenUrl: String(pending.tokenUrl),
      clientId: String(pending.clientId),
      clientSecret: typeof pending.clientSecret === "string" ? pending.clientSecret : undefined,
      code,
      redirectUri: String(pending.redirectUri),
      codeVerifier: String(pending.codeVerifier)
    });

    const encryptedCredentials = encryptCredentials({
      authScheme: "oauth2",
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      tokenType: tokenSet.tokenType,
      scope: tokenSet.scope,
      expiresAt: tokenSet.expiresAt,
      clientId: pending.clientId,
      clientSecret: pending.clientSecret,
      tokenUrl: pending.tokenUrl
    });

    const catalogEntry = CONNECTOR_CATALOG.find((c) => c.slug === slug);
    const connId = `conn-hub-${crypto.randomUUID().slice(0, 10)}`;
    const uniqueSlug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;
    const now = new Date();
    const discoveredTools = catalogEntry?.defaultTools ?? [
      { name: "http_probe", description: `Test ${name} connection` }
    ];

    await withWebTenantDb(user.tenantId, async (db) => {
      await db.insert(connectorConnections).values({
        id: connId,
        tenantId: user.tenantId,
        slug: uniqueSlug,
        name,
        category,
        transport: "http",
        endpointUrl,
        status: "connected",
        encryptedCredentials,
        config: {
          kind: slug,
          authScheme: "oauth2",
          connectedAccount: true,
          scope: tokenSet.scope ?? ""
        },
        discoveredTools,
        lastSyncAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: now
      });

      await db.insert(connectorSyncLogs).values({
        id: `csl-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        connectionId: connId,
        direction: "inbound",
        status: "success",
        recordsSynced: discoveredTools.length,
        latencyMs: 1,
        message: `Connected ${name} via OAuth 2.0 + PKCE`,
        payload: { authScheme: "oauth2", slug }
      });

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "connector_oauth_connect",
        toolName: "connectors.oauth_callback",
        args: { connectorId: connId, slug, endpointUrl },
        resultHash: "",
        status: "allowed",
        reason: `Connected ${name} via OAuth 2.0`,
        latencyMs: 1
      });
    });

    return redirectToConnectors(req, `?connected=${encodeURIComponent(name)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth connection failed";
    return redirectToConnectors(req, `?oauth_error=${encodeURIComponent(msg)}`);
  }
}
