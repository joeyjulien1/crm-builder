import { and, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { emailAccounts } from "@/lib/db/schema";
import { accessTokenFor as connectionAccessToken } from "@/lib/connectors/oauth";

/**
 * Gmail over its REST API. One integration, done properly, rather than two done
 * halfway — see "What v1 is not" in CLAUDE.md.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export function authorizeUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) throw new Error("Gmail is not configured on this deployment.");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  address: string;
}> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? "",
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) throw new Error(`Google refused the sign-in: ${await response.text()}`);
  const token = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  if (!token.refresh_token) {
    throw new Error("Google did not return a refresh token. Remove the app's access and connect again.");
  }

  const profile = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  const { email } = (await profile.json()) as { email: string };

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
    address: email,
  };
}

/**
 * A usable access token for a mailbox.
 *
 * The grant itself lives in `connections`, which is where refreshing and
 * re-storing happen for every provider alike. A mailbox row only knows which
 * connection it belongs to.
 */
export async function accessTokenFor(tenantId: string, accountId: string): Promise<string> {
  const [account] = await withTenant(tenantId, (db) =>
    db
      .select({ connectionId: emailAccounts.connectionId })
      .from(emailAccounts)
      .where(and(eq(emailAccounts.tenantId, tenantId), eq(emailAccounts.id, accountId)))
      .limit(1),
  );
  if (!account) throw new Error("That mailbox is no longer connected.");

  return connectionAccessToken(tenantId, account.connectionId);
}

export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string[];
  sentAt: Date;
  snippet: string;
}

async function call<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Gmail answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

export async function listMessageIds(
  token: string,
  options: { pageToken?: string; query?: string; limit?: number },
): Promise<{ ids: string[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ maxResults: String(options.limit ?? 100) });
  if (options.pageToken) params.set("pageToken", options.pageToken);
  if (options.query) params.set("q", options.query);

  const result = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(
    token,
    `/messages?${params.toString()}`,
  );
  return { ids: (result.messages ?? []).map((message) => message.id), nextPageToken: result.nextPageToken };
}

/**
 * Metadata only. Bodies are fetched separately and stored only where the user
 * opted in — copying every mailbox into your database is a liability and a
 * cost centre.
 */
export async function getMessageMetadata(token: string, id: string): Promise<GmailMessage> {
  const message = await call<{
    id: string;
    threadId: string;
    snippet: string;
    internalDate: string;
    payload: { headers: { name: string; value: string }[] };
  }>(
    token,
    `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`,
  );

  const header = (name: string): string =>
    message.payload.headers.find((entry) => entry.name.toLowerCase() === name)?.value ?? "";

  return {
    id: message.id,
    threadId: message.threadId,
    subject: header("subject"),
    from: parseAddress(header("from")),
    to: [...splitAddresses(header("to")), ...splitAddresses(header("cc"))],
    sentAt: new Date(Number(message.internalDate)),
    snippet: message.snippet,
  };
}

export async function getHistory(
  token: string,
  startHistoryId: string,
): Promise<{ ids: string[]; historyId?: string }> {
  const result = await call<{
    history?: { messagesAdded?: { message: { id: string } }[] }[];
    historyId?: string;
  }>(token, `/history?startHistoryId=${startHistoryId}&historyTypes=messageAdded`);

  const ids = (result.history ?? []).flatMap((entry) =>
    (entry.messagesAdded ?? []).map((added) => added.message.id),
  );
  return { ids, historyId: result.historyId };
}

export async function getProfile(token: string): Promise<{ historyId: string; address: string }> {
  const profile = await call<{ historyId: string; emailAddress: string }>(token, "/profile");
  return { historyId: profile.historyId, address: profile.emailAddress };
}

export async function sendMessage(
  token: string,
  message: { from: string; to: string; subject: string; body: string },
): Promise<{ id: string }> {
  const raw = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    message.body,
  ].join("\r\n");

  const response = await fetch(`${API}/messages/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }),
  });

  if (!response.ok) throw new Error(`Gmail refused to send: ${await response.text()}`);
  return (await response.json()) as { id: string };
}

export function parseAddress(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim().toLowerCase();
}

export function splitAddresses(value: string): string[] {
  if (!value.trim()) return [];
  return value
    .split(",")
    .map((entry) => parseAddress(entry))
    .filter(Boolean);
}

export function domainOf(address: string): string {
  return address.split("@")[1]?.toLowerCase() ?? "";
}
