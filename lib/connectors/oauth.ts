import { and, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { connections } from "@/lib/db/schema";
import { decryptToken, encryptToken } from "@/lib/email/crypto";
import {
  asOAuth,
  credentialKind,
  isConfigured,
  providerFor,
  type OAuthProviderConfig,
  type ProviderConfig,
} from "./registry";

/**
 * One OAuth implementation for every provider, driven by the registry.
 *
 * Tokens are encrypted before they reach the database and decrypted only here.
 * Nothing in this module returns one to a caller that could send it to a
 * browser — `accessTokenFor` is server-only by construction, since the client
 * has no route that reaches it.
 */

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
}

function credentials(provider: OAuthProviderConfig): { id: string; secret: string } {
  const id = process.env[provider.clientIdEnv];
  const secret = process.env[provider.clientSecretEnv];
  if (!id || !secret) {
    throw new Error(`${provider.label} is not configured on this deployment.`);
  }
  return { id, secret };
}

/** Every provider comes back to the same route, which keeps redirect URIs few. */
export function redirectUri(providerKey: string): string {
  const base = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!base) throw new Error("APP_URL is not set, so OAuth has nowhere to return to.");
  return `${base.replace(/\/$/, "")}/api/connectors/${providerKey}/callback`;
}

export function authorizeUrl(input: ProviderConfig, state: string): string {
  const provider = asOAuth(input);
  const { id } = credentials(provider);
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", redirectUri(provider.key));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (provider.scopes.length > 0) url.searchParams.set("scope", provider.scopes.join(" "));
  for (const [key, value] of Object.entries(provider.authorizeParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  // Slack nests the token it actually wants you to use.
  authed_user?: { access_token?: string };
  error?: string;
  error_description?: string;
}

async function postForm(url: string, body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  const parsed = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || parsed.error) {
    throw new Error(parsed.error_description ?? parsed.error ?? `Token exchange failed (${response.status}).`);
  }
  return parsed;
}

function toTokenSet(parsed: TokenResponse, provider: OAuthProviderConfig): TokenSet {
  const accessToken = parsed.access_token ?? parsed.authed_user?.access_token;
  if (!accessToken) throw new Error(`${provider.label} did not return an access token.`);
  return {
    accessToken,
    refreshToken: parsed.refresh_token,
    expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000) : undefined,
    scopes: parsed.scope ? parsed.scope.split(/[\s,]+/).filter(Boolean) : provider.scopes,
  };
}

export async function exchangeCode(input: ProviderConfig, code: string): Promise<TokenSet> {
  const provider = asOAuth(input);
  const { id, secret } = credentials(provider);
  const parsed = await postForm(
    provider.tokenUrl,
    new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri(provider.key),
      grant_type: "authorization_code",
    }),
  );
  return toTokenSet(parsed, provider);
}

/** Reads who the token belongs to, so the panel can say "Connected as …". */
export async function fetchIdentity(
  input: ProviderConfig,
  accessToken: string,
): Promise<{ id: string; label: string }> {
  const provider = asOAuth(input);
  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
  // Notion versions its API by header and refuses requests without one.
  if (provider.key === "notion") headers["Notion-Version"] = "2022-06-28";

  const response = await fetch(provider.identity.url, { headers });
  if (!response.ok) throw new Error(`${provider.label} would not confirm the account.`);

  const body = (await response.json()) as Record<string, unknown>;
  const identity = provider.identity.read(body);
  return {
    id: identity.id || `${provider.key}:unknown`,
    label: identity.label || provider.label,
  };
}

/** Stores a grant, replacing any earlier one for the same external account. */
export async function saveConnection(args: {
  tenantId: string;
  userId: string;
  provider: ProviderConfig;
  token: TokenSet;
  identity: { id: string; label: string };
}): Promise<string> {
  const { tenantId, userId, provider, token, identity } = args;

  return withTenant(tenantId, async (db) => {
    const [row] = await db
      .insert(connections)
      .values({
        tenantId,
        userId,
        provider: provider.key,
        externalAccountId: identity.id,
        accountLabel: identity.label,
        accessTokenEnc: encryptToken(token.accessToken),
        refreshTokenEnc: token.refreshToken ? encryptToken(token.refreshToken) : null,
        accessTokenExpiresAt: token.expiresAt ?? null,
        scopes: token.scopes,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [
          connections.tenantId,
          connections.userId,
          connections.provider,
          connections.externalAccountId,
        ],
        set: {
          accountLabel: identity.label,
          accessTokenEnc: encryptToken(token.accessToken),
          // A re-consent that returns no refresh token must not erase the one
          // already held, or the connection silently stops surviving an hour.
          ...(token.refreshToken ? { refreshTokenEnc: encryptToken(token.refreshToken) } : {}),
          accessTokenExpiresAt: token.expiresAt ?? null,
          scopes: token.scopes,
          status: "active",
          connectedAt: new Date(),
        },
      })
      .returning();

    return row!.id;
  });
}

/**
 * A usable access token, refreshed and re-stored when stale. Server-side only:
 * nothing returns this to a browser.
 */
export async function accessTokenFor(
  tenantId: string,
  connectionId: string,
): Promise<string> {
  const [row] = await withTenant(tenantId, (db) =>
    db
      .select()
      .from(connections)
      .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
      .limit(1),
  );
  if (!row) throw new Error("That account is no longer connected.");

  const provider = providerFor(row.provider);
  if (!provider) throw new Error(`Unknown provider: ${row.provider}`);

  const fresh =
    row.accessTokenEnc &&
    (!row.accessTokenExpiresAt || row.accessTokenExpiresAt.getTime() > Date.now() + 60_000);
  if (fresh) return decryptToken(row.accessTokenEnc!);

  // A key does not expire and cannot be refreshed. If it has stopped working,
  // the user has to paste a new one.
  if (credentialKind(provider) === "api_key") {
    if (!row.accessTokenEnc) throw new Error(`${provider.label} needs reconnecting.`);
    return decryptToken(row.accessTokenEnc);
  }

  if (!row.refreshTokenEnc) {
    await markStatus(tenantId, connectionId, "expired");
    throw new Error(`${provider.label} needs reconnecting.`);
  }

  const oauth = asOAuth(provider);
  const { id, secret } = credentials(oauth);
  let parsed: TokenResponse;
  try {
    parsed = await postForm(
      oauth.tokenUrl,
      new URLSearchParams({
        refresh_token: decryptToken(row.refreshTokenEnc),
        client_id: id,
        client_secret: secret,
        grant_type: "refresh_token",
      }),
    );
  } catch (error) {
    // A refusal here means consent is gone, not that the network blipped.
    await markStatus(tenantId, connectionId, "expired");
    throw new Error(`${provider.label} needs reconnecting: ${(error as Error).message}`);
  }

  const token = toTokenSet(parsed, oauth);
  await withTenant(tenantId, (db) =>
    db
      .update(connections)
      .set({
        accessTokenEnc: encryptToken(token.accessToken),
        accessTokenExpiresAt: token.expiresAt ?? null,
        ...(token.refreshToken ? { refreshTokenEnc: encryptToken(token.refreshToken) } : {}),
        status: "active",
      })
      .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId))),
  );

  return token.accessToken;
}

async function markStatus(tenantId: string, connectionId: string, status: string): Promise<void> {
  await withTenant(tenantId, (db) =>
    db
      .update(connections)
      .set({ status })
      .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId))),
  );
}

/**
 * Disconnecting revokes at the provider first, then drops the row. Deleting
 * only our copy would leave the grant standing on the provider's side, which
 * is not what "disconnect" means to anyone who clicks it.
 */
export async function disconnect(
  tenantId: string,
  connectionId: string,
): Promise<{ revoked: boolean; reason?: string }> {
  const [row] = await withTenant(tenantId, (db) =>
    db
      .select()
      .from(connections)
      .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
      .limit(1),
  );
  if (!row) return { revoked: false, reason: "That account was already disconnected." };

  const provider = providerFor(row.provider);
  let revoked = false;
  let reason: string | undefined;

  if (provider?.revokeUrl && credentialKind(provider) === "oauth2" && isConfigured(provider)) {
    try {
      const token = row.refreshTokenEnc ?? row.accessTokenEnc;
      if (token) {
        const { id, secret } = credentials(asOAuth(provider));
        const response = await fetch(provider.revokeUrl, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            // Zoom and Slack authenticate revocation differently to Google;
            // sending both satisfies all three without branching per provider.
            authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
          },
          body: new URLSearchParams({ token: decryptToken(token) }),
        });
        revoked = response.ok;
        if (!response.ok) reason = `${provider.label} did not confirm the revocation.`;
      }
    } catch (error) {
      reason = `${provider.label} could not be reached to revoke access.`;
      console.error("revocation failed:", error);
    }
  } else if (provider && !provider.revokeUrl) {
    reason = `${provider.label} has no revocation endpoint — remove access from your ${provider.label} account settings too.`;
  }

  await withTenant(tenantId, (db) =>
    db.delete(connections).where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId))),
  );

  return { revoked, reason };
}
