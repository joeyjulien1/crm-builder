import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { emailAccounts } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";

export default async function EmailSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const params = await searchParams;
  const accounts = await withTenant(session.tenantId, (db) =>
    db
      .select({
        id: emailAccounts.id,
        address: emailAccounts.address,
        backfillDone: emailAccounts.backfillDone,
        storeBodies: emailAccounts.storeBodies,
      })
      .from(emailAccounts)
      .where(eq(emailAccounts.tenantId, session.tenantId)),
  );

  const configured = Boolean(process.env.GOOGLE_CLIENT_ID);

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <h1 className="mb-1 text-sm font-medium">Email</h1>
      <p className="mb-5 max-w-[70ch] text-xs text-content-secondary">
        Connect a mailbox and messages are matched to records by address, then by domain for
        companies. Only the sender, recipients, subject and date are stored — message bodies stay in
        your mailbox unless you turn that on.
      </p>

      {params.error ? (
        <p role="alert" className="mb-4 text-xs text-[var(--danger)]">
          That mailbox could not be connected. Try again, and if it keeps failing, remove this app
          from your Google account and reconnect.
        </p>
      ) : null}

      {params.connected ? (
        <p className="mb-4 text-xs text-[var(--success)]">
          Connected. The first sync runs in the background and takes a few minutes.
        </p>
      ) : null}

      {accounts.length > 0 ? (
        <ul className="mb-5 flex flex-col gap-2">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex items-center justify-between gap-4 rounded border border-edge px-4 py-3"
            >
              <span className="text-sm">{account.address}</span>
              <Badge tone={account.backfillDone ? "success" : "neutral"}>
                {account.backfillDone ? "History synced" : "Syncing history"}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-5 text-sm text-content-secondary">No mailbox is connected yet.</p>
      )}

      {configured ? (
        <Link
          href="/api/connectors/gmail/connect"
          className="inline-block h-control rounded bg-accent px-3 py-2 text-sm text-accent-fg hover:bg-accent-hover"
        >
          Connect Gmail
        </Link>
      ) : (
        <p className="text-xs text-content-muted">
          Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI to enable this.
        </p>
      )}
    </div>
  );
}
