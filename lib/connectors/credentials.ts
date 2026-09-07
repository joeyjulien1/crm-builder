import { and, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { connections } from "@/lib/db/schema";
import { encryptToken } from "@/lib/email/crypto";
import { credentialKind, type ProviderConfig } from "./registry";

/**
 * Connecting a provider that has no OAuth flow.
 *
 * Twilio is an account SID and an auth token; plenty of useful providers are
 * just a key. The `connections` table stores this exactly as happily as it
 * stores a grant — the values go in encrypted, the same column, so this needed
 * no migration and no second concept of "a connected account".
 *
 * The values never come back out to a browser. The panel shows the account
 * label and nothing else.
 */
export function validateCredentials(
  provider: ProviderConfig,
  values: Record<string, unknown>,
): Record<string, string> {
  if (credentialKind(provider) !== "api_key") {
    throw new Error(`${provider.label} is connected with a grant, not a key.`);
  }

  const clean: Record<string, string> = {};
  for (const field of provider.credentialFields ?? []) {
    const value = values[field.key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${field.label} is needed to connect ${provider.label}.`);
    }
    if (value.length > 500) throw new Error(`${field.label} is too long to be right.`);
    clean[field.key] = value.trim();
  }
  return clean;
}

export async function saveKeyConnection(args: {
  tenantId: string;
  userId: string;
  provider: ProviderConfig;
  values: Record<string, string>;
}): Promise<{ account: string }> {
  const { tenantId, userId, provider, values } = args;

  const externalAccountId = values[provider.accountIdField ?? ""] ?? provider.key;
  const accountLabel = values[provider.accountLabelField ?? ""] ?? provider.label;

  await withTenant(tenantId, async (db) => {
    await db
      .delete(connections)
      .where(
        and(
          eq(connections.tenantId, tenantId),
          eq(connections.userId, userId),
          eq(connections.provider, provider.key),
        ),
      );

    await db.insert(connections).values({
      tenantId,
      userId,
      provider: provider.key,
      externalAccountId,
      accountLabel,
      // The whole credential set, encrypted, in the column a token would use.
      accessTokenEnc: encryptToken(JSON.stringify(values)),
      scopes: [],
      status: "active",
    });
  });

  return { account: accountLabel };
}
