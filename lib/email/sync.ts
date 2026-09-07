import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { emailAccounts, emailLinks, emailMessages, records } from "@/lib/db/schema";
import { getCurrentVersion } from "@/lib/config/version";
import type { Config } from "@/lib/config/types";
import {
  domainOf,
  getHistory,
  getMessageMetadata,
  getProfile,
  listMessageIds,
  accessTokenFor,
  type GmailMessage,
} from "./gmail";

/**
 * Backfill and live sync are separate, resumable jobs that share only the
 * matching logic. Treating them as one thing is how this milestone overruns.
 */

const BACKFILL_PAGE = 100;

export interface SyncResult {
  fetched: number;
  linked: number;
  cursor?: string;
  done: boolean;
}

/** Walks history backwards a page at a time, storing its cursor as it goes. */
export async function backfillPage(tenantId: string, accountId: string): Promise<SyncResult> {
  const account = await loadAccount(tenantId, accountId);
  if (account.backfillDone) return { fetched: 0, linked: 0, done: true };

  const token = await accessTokenFor(tenantId, accountId);
  const page = await listMessageIds(token, {
    pageToken: account.backfillCursor ?? undefined,
    limit: BACKFILL_PAGE,
  });

  const linked = await ingest(tenantId, accountId, token, page.ids);

  await withTenant(tenantId, (db) =>
    db
      .update(emailAccounts)
      .set({
        backfillCursor: page.nextPageToken ?? null,
        backfillDone: !page.nextPageToken,
      })
      .where(and(eq(emailAccounts.tenantId, tenantId), eq(emailAccounts.id, accountId))),
  );

  return {
    fetched: page.ids.length,
    linked,
    cursor: page.nextPageToken,
    done: !page.nextPageToken,
  };
}

/** The live side: everything since the stored history id. */
export async function syncSince(tenantId: string, accountId: string): Promise<SyncResult> {
  const account = await loadAccount(tenantId, accountId);
  const token = await accessTokenFor(tenantId, accountId);

  if (!account.historyId) {
    const profile = await getProfile(token);
    await withTenant(tenantId, (db) =>
      db
        .update(emailAccounts)
        .set({ historyId: profile.historyId })
        .where(and(eq(emailAccounts.tenantId, tenantId), eq(emailAccounts.id, accountId))),
    );
    return { fetched: 0, linked: 0, done: true };
  }

  const history = await getHistory(token, account.historyId);
  const linked = await ingest(tenantId, accountId, token, history.ids);

  if (history.historyId) {
    await withTenant(tenantId, (db) =>
      db
        .update(emailAccounts)
        .set({ historyId: history.historyId })
        .where(and(eq(emailAccounts.tenantId, tenantId), eq(emailAccounts.id, accountId))),
    );
  }

  return { fetched: history.ids.length, linked, done: true };
}

async function loadAccount(tenantId: string, accountId: string) {
  const [account] = await withTenant(tenantId, (db) =>
    db
      .select()
      .from(emailAccounts)
      .where(and(eq(emailAccounts.tenantId, tenantId), eq(emailAccounts.id, accountId)))
      .limit(1),
  );
  if (!account) throw new Error("That mailbox is no longer connected.");
  return account;
}

async function ingest(
  tenantId: string,
  accountId: string,
  token: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;

  const config = await withTenant(tenantId, async (db) => (await getCurrentVersion(db, tenantId)).config);

  let linked = 0;
  for (const id of ids) {
    const message = await getMessageMetadata(token, id);
    const stored = await store(tenantId, accountId, message);
    if (!stored) continue;
    linked += await link(tenantId, config, stored, message);
  }
  return linked;
}

async function store(
  tenantId: string,
  accountId: string,
  message: GmailMessage,
): Promise<string | null> {
  const rows = await withTenant(tenantId, (db) =>
    db
      .insert(emailMessages)
      .values({
        tenantId,
        accountId,
        providerMessageId: message.id,
        threadId: message.threadId,
        subject: message.subject,
        fromAddress: message.from,
        toAddresses: message.to,
        sentAt: message.sentAt,
        // Bodies stay out unless the user opted in; the pointer is enough.
        body: null,
      })
      .onConflictDoNothing({
        target: [emailMessages.tenantId, emailMessages.accountId, emailMessages.providerMessageId],
      })
      .returning({ id: emailMessages.id }),
  );

  return rows[0]?.id ?? null;
}

/**
 * Matches a message to records by email address first, then by domain for
 * companies — the same order a person would use.
 */
async function link(
  tenantId: string,
  config: Config,
  messageId: string,
  message: GmailMessage,
): Promise<number> {
  const addresses = [message.from, ...message.to];
  const domains = [...new Set(addresses.map(domainOf).filter(Boolean))];

  const emailFieldIds = config.objects.flatMap((object) =>
    object.fields.filter((field) => field.type === "email").map((field) => ({ object: object.key, id: field.id })),
  );
  const domainFieldIds = config.objects.flatMap((object) =>
    object.fields
      .filter((field) => field.type === "url" && field.key.includes("domain"))
      .map((field) => ({ object: object.key, id: field.id })),
  );

  const matches = await withTenant(tenantId, async (db) => {
    const found: { recordId: string; matchedBy: string }[] = [];

    for (const field of emailFieldIds) {
      const rows = await db
        .select({ id: records.id })
        .from(records)
        .where(
          and(
            eq(records.tenantId, tenantId),
            eq(records.objectKey, field.object),
            isNull(records.deletedAt),
            sql`lower(${records.data} ->> ${field.id}) = any(array[${sql.join(
              addresses.map((address) => sql`${address}`),
              sql`, `,
            )}]::text[])`,
          ),
        )
        .limit(20);
      found.push(...rows.map((row) => ({ recordId: row.id, matchedBy: "address" })));
    }

    // Domain matching is a fallback, and only for companies.
    if (found.length === 0 && domains.length > 0) {
      for (const field of domainFieldIds) {
        const rows = await db
          .select({ id: records.id })
          .from(records)
          .where(
            and(
              eq(records.tenantId, tenantId),
              eq(records.objectKey, field.object),
              isNull(records.deletedAt),
              sql`lower(regexp_replace(coalesce(${records.data} ->> ${field.id}, ''), '^https?://(www\\.)?', '')) = any(array[${sql.join(
                domains.map((domain) => sql`${domain}`),
                sql`, `,
              )}]::text[])`,
            ),
          )
          .limit(20);
        found.push(...rows.map((row) => ({ recordId: row.id, matchedBy: "domain" })));
      }
    }

    return found;
  });

  if (matches.length === 0) return 0;

  await withTenant(tenantId, (db) =>
    db
      .insert(emailLinks)
      .values(
        matches.map((match) => ({
          tenantId,
          messageId,
          recordId: match.recordId,
          matchedBy: match.matchedBy,
        })),
      )
      .onConflictDoNothing({ target: [emailLinks.tenantId, emailLinks.messageId, emailLinks.recordId] }),
  );

  return matches.length;
}

/** The timeline's email half. */
export async function emailsForRecord(
  tenantId: string,
  recordId: string,
  limit = 25,
): Promise<{ id: string; subject: string; from: string; sentAt: string }[]> {
  return withTenant(tenantId, async (db) => {
    const links = await db
      .select({ messageId: emailLinks.messageId })
      .from(emailLinks)
      .where(and(eq(emailLinks.tenantId, tenantId), eq(emailLinks.recordId, recordId)))
      .limit(limit);

    if (links.length === 0) return [];

    const rows = await db
      .select()
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.tenantId, tenantId),
          inArray(
            emailMessages.id,
            links.map((entry) => entry.messageId),
          ),
        ),
      )
      .orderBy(sql`${emailMessages.sentAt} desc`);

    return rows.map((row) => ({
      id: row.id,
      subject: row.subject ?? "(no subject)",
      from: row.fromAddress,
      sentAt: row.sentAt.toISOString(),
    }));
  });
}
