import { emailAccounts } from "@/lib/db/schema";
import { withTenant } from "@/lib/db/client";
import { getProfile } from "@/lib/email/gmail";
import { enqueue, QUEUES } from "@/lib/jobs/queue";
import type { EmailJob } from "@/lib/email/worker";

/**
 * Gmail is both a connection and a mailbox. The grant lives in `connections`;
 * this adds the sync state that mail alone needs, and starts the two jobs.
 *
 * Backfill and live sync stay separate jobs, as they were before connections
 * existed — see docs/ARCHITECTURE.md.
 */
export async function linkMailbox(args: {
  tenantId: string;
  userId: string;
  connectionId: string;
  address: string;
  accessToken: string;
}): Promise<void> {
  const { tenantId, userId, connectionId, address, accessToken } = args;

  const profile = await getProfile(accessToken);

  const accountId = await withTenant(tenantId, async (db) => {
    const [account] = await db
      .insert(emailAccounts)
      .values({
        tenantId,
        userId,
        provider: "gmail",
        address,
        connectionId,
        historyId: profile.historyId,
      })
      .onConflictDoUpdate({
        target: [emailAccounts.tenantId, emailAccounts.userId, emailAccounts.address],
        set: { connectionId, historyId: profile.historyId },
      })
      .returning({ id: emailAccounts.id });
    return account?.id;
  });

  if (accountId) {
    await enqueue<EmailJob>(QUEUES.emailBackfill, { tenantId, accountId });
    await enqueue<EmailJob>(QUEUES.emailSync, { tenantId, accountId });
  }
}
