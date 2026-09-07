import { and, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { connections } from "@/lib/db/schema";
import { decryptToken } from "@/lib/email/crypto";
import { accessTokenFor } from "./oauth";
import { credentialKind, providerFor, type ProviderConfig } from "./registry";

/**
 * Calling a provider's API on the workspace's behalf.
 *
 * The connector registry granted access and then stopped: there was no generic
 * "call provider X with the connection the tenant granted", so every provider's
 * API surface was bespoke code (`lib/email/gmail.ts` hand-rolls its own fetch
 * wrapper). One workflow step that posts to Slack should not mean a new module.
 *
 * What this owns: finding the connection, turning the stored credential into
 * headers, a timeout, and turning a refusal into a sentence. What it does not
 * own: what any particular endpoint means. A step says which path and body it
 * wants; only the provider's own quirks — Slack answering 200 for a failure —
 * live in the registry.
 */

export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorError";
  }
}

const TIMEOUT_MS = 10_000;

interface ConnectionRow {
  id: string;
  provider: string;
  accessTokenEnc: string | null;
  accountLabel: string;
  status: string;
}

/** The workspace's connection for a provider, whoever in it granted the access. */
export async function connectionFor(tenantId: string, providerKey: string): Promise<ConnectionRow> {
  const [row] = await withTenant(tenantId, (db) =>
    db
      .select({
        id: connections.id,
        provider: connections.provider,
        accessTokenEnc: connections.accessTokenEnc,
        accountLabel: connections.accountLabel,
        status: connections.status,
      })
      .from(connections)
      .where(and(eq(connections.tenantId, tenantId), eq(connections.provider, providerKey)))
      .limit(1),
  );

  const provider = providerFor(providerKey);
  if (!row) {
    throw new ConnectorError(
      `${provider?.label ?? providerKey} is not connected to this workspace. Connect it in the agent panel and run this again.`,
    );
  }
  if (row.status !== "active") {
    throw new ConnectorError(`${provider?.label ?? providerKey} needs reconnecting.`);
  }
  return row;
}

/** The values an api_key connection stores, decrypted. Server-side only. */
export async function credentialValues(
  tenantId: string,
  providerKey: string,
): Promise<Record<string, string>> {
  const row = await connectionFor(tenantId, providerKey);
  if (!row.accessTokenEnc) throw new ConnectorError("That connection is missing its credentials.");
  try {
    return JSON.parse(decryptToken(row.accessTokenEnc)) as Record<string, string>;
  } catch {
    throw new ConnectorError("That connection's credentials could not be read. Reconnect it.");
  }
}

export interface ProviderCall {
  /** Relative to the provider's apiBase, or absolute. */
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** JSON by default; pass form-encoded providers a URLSearchParams. */
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ProviderResponse {
  status: number;
  body: unknown;
}

async function headersFor(
  tenantId: string,
  provider: ProviderConfig,
): Promise<Record<string, string>> {
  if (credentialKind(provider) === "api_key") {
    const values = await credentialValues(tenantId, provider.key);
    if (!provider.authHeaders) {
      throw new ConnectorError(`${provider.label} does not say how to authenticate a call.`);
    }
    return provider.authHeaders(values);
  }

  const connection = await connectionFor(tenantId, provider.key);
  return { authorization: `Bearer ${await accessTokenFor(tenantId, connection.id)}` };
}

export async function callProvider(
  tenantId: string,
  providerKey: string,
  call: ProviderCall,
): Promise<ProviderResponse> {
  const provider = providerFor(providerKey);
  if (!provider) throw new ConnectorError(`There is no ${providerKey} connector.`);

  const url = call.path.startsWith("http")
    ? call.path
    : `${(provider.apiBase ?? "").replace(/\/$/, "")}/${call.path.replace(/^\//, "")}`;

  const form = call.body instanceof URLSearchParams;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: call.method ?? (call.body ? "POST" : "GET"),
      headers: {
        ...(await headersFor(tenantId, provider)),
        ...(call.body
          ? { "content-type": form ? "application/x-www-form-urlencoded" : "application/json" }
          : {}),
        ...call.headers,
      },
      body: call.body === undefined ? undefined : form ? (call.body as URLSearchParams) : JSON.stringify(call.body),
      signal: controller.signal,
    });

    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Not every provider answers JSON. The text is what we have.
    }

    if (!response.ok) {
      throw new ConnectorError(`${provider.label} answered ${response.status}: ${shorten(text)}`);
    }

    const refusal = provider.checkResponse?.(body);
    if (refusal) throw new ConnectorError(`${provider.label} refused that: ${refusal}`);

    return { status: response.status, body };
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new ConnectorError(`${provider.label} did not answer within ${TIMEOUT_MS / 1000} seconds.`);
    }
    throw new ConnectorError(`${provider.label} could not be reached: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function shorten(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
}
