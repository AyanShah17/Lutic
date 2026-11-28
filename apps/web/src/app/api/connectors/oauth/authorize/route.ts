import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  assertSafeExternalUrlSyntax,
  authorize,
  buildOAuthAuthorizationUrl,
  CONNECTOR_CATALOG,
  CONNECTOR_OAUTH_COOKIE,
  encryptCredentials,
  generatePkcePair,
  getConnectorAuthBlueprint
} from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { enforceApiQuota, enforceConnectorQuota } from "@/lib/quota";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const AuthorizeSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  name: z.string().trim().max(160).optional(),
  endpointUrl: z.string().trim().max(500).optional(),
  scopes: z.array(z.string().trim().min(1)).optional(),
  clientId: z.string().trim().max(256).optional(),
  clientSecret: z.string().trim().max(512).optional(),
  authorizationUrl: z.string().trim().max(500).optional(),
  tokenUrl: z.string().trim().max(500).optional()
});

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "connector:write", { tenantId: user.tenantId });

    const body = AuthorizeSchema.parse(await req.json());
    const slug = body.slug.toLowerCase();
    const entry = CONNECTOR_CATALOG.find((c) => c.slug === slug);
    const blueprint = getConnectorAuthBlueprint({
      slug,
      name: body.name?.trim() || entry?.name || body.slug,
      category: entry?.category,
      transport: entry?.transport,
      credentialFields: entry?.credentialFields
    });

    const authorizationUrl = body.authorizationUrl || blueprint.oauthProvider?.authorizationUrl || "";
    const tokenUrl = body.tokenUrl || blueprint.oauthProvider?.tokenUrl || "";
    if (!authorizationUrl || !tokenUrl) {
      return problemResponse(
        400,
        "OAuth Configuration Missing",
        "Supply authorizationUrl and tokenUrl for custom OAuth providers."
      );
    }

    try {
      assertSafeExternalUrlSyntax(authorizationUrl);
      assertSafeExternalUrlSyntax(tokenUrl);
    } catch (err) {
      return problemResponse(
        400,
        "Unsafe OAuth Endpoint",
        err instanceof Error ? err.message : "OAuth authorizationUrl and tokenUrl must use public HTTPS endpoints."
      );
    }

    const quotaBlock = await withWebTenantDb(user.tenantId, async (db) => {
      const apiErr = await enforceApiQuota(req, db, user, "api");
      if (apiErr) return apiErr;
      return enforceConnectorQuota(db, user.tenantId);
    });
    if (quotaBlock) return quotaBlock;

    const envPrefix = `LUTIC_OAUTH_${slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
    const clientId = body.clientId?.trim() || process.env[`${envPrefix}_CLIENT_ID`]?.trim() || "";
    const clientSecret =
      body.clientSecret?.trim() || process.env[`${envPrefix}_CLIENT_SECRET`]?.trim() || "";

    if (!clientId) {
      return problemResponse(
        400,
        "OAuth Client ID Required",
        `Enter your ${blueprint.name} OAuth Client ID (or configure ${envPrefix}_CLIENT_ID on the server).`
      );
    }

    const reqUrl = new URL(req.url);
    const redirectUri = `${reqUrl.origin}/api/connectors/oauth/callback`;
    const state = crypto.randomBytes(24).toString("base64url");
    const pkce = generatePkcePair();
    const scopes = body.scopes ?? blueprint.oauthProvider?.defaultScopes ?? [];

    const authUrl = buildOAuthAuthorizationUrl({
      authorizationUrl,
      clientId,
      redirectUri,
      state,
      scopes,
      codeChallenge: pkce.codeChallenge
    });

    const sealedState = encryptCredentials({
      state,
      codeVerifier: pkce.codeVerifier,
      tenantId: user.tenantId,
      userId: user.userId,
      slug,
      name: body.name?.trim() || blueprint.name,
      category: entry?.category ?? "http",
      endpointUrl: body.endpointUrl?.trim() || blueprint.defaultEndpointUrl,
      clientId,
      clientSecret,
      tokenUrl,
      redirectUri,
      exp: Date.now() + 10 * 60_000
    });

    const res = NextResponse.json({
      authorizationUrl: authUrl,
      redirectUri
    });
    res.cookies.set(CONNECTOR_OAUTH_COOKIE, sealedState, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600
    });
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
