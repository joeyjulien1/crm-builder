import { and, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { connections } from "@/lib/db/schema";
import { credentialKind, isConfigured, PROVIDERS, type CredentialField, type CredentialKind } from "./registry";

/**
 * What the panel and the agent both read.
 *
 * Everything here is safe to send to a browser: labels and statuses, never a
 * token. The select lists its columns for that reason rather than taking the
 * row and trusting a later change not to widen it.
 */

export interface ConnectorState {
  provider: string;
  label: string;
  blurb: string;
  /** How this one is connected: a popup grant, or a form. */
  kind: CredentialKind;
  /** What the form asks for. api_key providers only, and never their values. */
  credentialFields?: CredentialField[];
  configured: boolean;
  connected: boolean;
  /** Present only when connected. */
  connectionId?: string;
  account?: string;
  status?: string;
  scopes?: string[];
}

export async function connectorStates(tenantId: string, userId: string): Promise<ConnectorState[]> {
  const rows = await withTenant(tenantId, (db) =>
    db
      .select({
        id: connections.id,
        provider: connections.provider,
        accountLabel: connections.accountLabel,
        status: connections.status,
        scopes: connections.scopes,
      })
      .from(connections)
      .where(and(eq(connections.tenantId, tenantId), eq(connections.userId, userId))),
  );

  const byProvider = new Map(rows.map((row) => [row.provider, row]));

  return PROVIDERS.map((provider) => {
    const row = byProvider.get(provider.key);
    return {
      provider: provider.key,
      label: provider.label,
      blurb: provider.blurb,
      kind: credentialKind(provider),
      ...(provider.credentialFields ? { credentialFields: provider.credentialFields } : {}),
      configured: isConfigured(provider),
      connected: Boolean(row) && row!.status === "active",
      ...(row
        ? {
            connectionId: row.id,
            account: row.accountLabel,
            status: row.status,
            scopes: row.scopes,
          }
        : {}),
    };
  });
}

/** What the agent asks before attempting anything that needs a provider. */
export async function isConnected(
  tenantId: string,
  userId: string,
  providerKey: string,
): Promise<boolean> {
  const [row] = await withTenant(tenantId, (db) =>
    db
      .select({ status: connections.status })
      .from(connections)
      .where(
        and(
          eq(connections.tenantId, tenantId),
          eq(connections.userId, userId),
          eq(connections.provider, providerKey),
        ),
      )
      .limit(1),
  );
  return row?.status === "active";
}
