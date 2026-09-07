import { eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { emailAccounts } from "@/lib/db/schema";
import { accessTokenFor, sendMessage } from "./gmail";

/**
 * Automations send through a mailbox the workspace has connected, never through
 * an anonymous relay. If nothing is connected the run fails loudly — an
 * automation that silently drops mail is worse than one that stops.
 */
export async function sendAutomationEmail(
  tenantId: string,
  message: { to: string; subject: string; body: string },
): Promise<{ sent: true; id: string }> {
  const [account] = await withTenant(tenantId, (db) =>
    db.select().from(emailAccounts).where(eq(emailAccounts.tenantId, tenantId)).limit(1),
  );

  if (!account) {
    throw new Error(
      "No mailbox is connected, so this email was not sent. Connect one in settings and re-run the automation.",
    );
  }

  const token = await accessTokenFor(tenantId, account.id);
  const result = await sendMessage(token, {
    from: account.address,
    to: message.to,
    subject: message.subject,
    body: message.body,
  });

  return { sent: true, id: result.id };
}
