import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { exchangeCode, fetchIdentity, saveConnection } from "@/lib/connectors/oauth";
import { providerFor } from "@/lib/connectors/registry";
import { linkMailbox } from "@/lib/connectors/mailbox";

/**
 * Where every provider returns to.
 *
 * This runs inside the popup the sidebar opened, so it renders a page that
 * tells the opener what happened and closes itself. The conversation behind it
 * never navigated, so the agent can carry on with whatever needed the account.
 *
 * The message carries a provider key and a status. It never carries a token.
 */

function closingPage(payload: Record<string, string>, origin: string): Response {
  // Serialised as JSON and injected into a script, so a provider-supplied
  // label cannot break out of the string and become markup.
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Connecting…</title>
<body style="font:14px system-ui;padding:24px;color:#333">
<p>${payload.status === "connected" ? "Connected. You can close this window." : "That did not complete. You can close this window."}</p>
<script>
  try { window.opener && window.opener.postMessage(${json}, ${JSON.stringify(origin)}); } catch (e) {}
  window.close();
</script>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const url = new URL(request.url);
  const origin = process.env.APP_URL?.replace(/\/$/, "") ?? url.origin;

  const session = await getSession();
  const { provider: key } = await params;
  const provider = providerFor(key);

  if (!session) return closingPage({ source: "connector", status: "error", provider: key, message: "Your session expired." }, origin);
  if (!provider) return closingPage({ source: "connector", status: "error", provider: key, message: "No such connector." }, origin);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  const store = await cookies();
  const cookieName = `connector_state_${provider.key}`;
  const expected = store.get(cookieName)?.value;
  store.delete(cookieName);

  if (denied) {
    return closingPage({ source: "connector", status: "cancelled", provider: provider.key, message: `${provider.label} was not connected.` }, origin);
  }
  if (!code) {
    return closingPage({ source: "connector", status: "error", provider: provider.key, message: `${provider.label} did not return an authorization code.` }, origin);
  }
  // Constant-time is unnecessary here — the value is single-use, unguessable,
  // and compared once — but presence and equality both have to hold.
  if (!state || !expected || state !== expected) {
    return closingPage({ source: "connector", status: "error", provider: provider.key, message: "That request did not start here. Try connecting again." }, origin);
  }

  try {
    const token = await exchangeCode(provider, code);
    const identity = await fetchIdentity(provider, token.accessToken);
    const connectionId = await saveConnection({
      tenantId: session.tenantId,
      userId: session.userId,
      provider,
      token,
      identity,
    });

    // Gmail additionally drives mail sync, which needs its own row.
    if (provider.key === "gmail") {
      await linkMailbox({
        tenantId: session.tenantId,
        userId: session.userId,
        connectionId,
        address: identity.label,
        accessToken: token.accessToken,
      });
    }

    return closingPage(
      { source: "connector", status: "connected", provider: provider.key, account: identity.label },
      origin,
    );
  } catch (error) {
    console.error(`${provider.key} callback failed:`, error);
    return closingPage(
      {
        source: "connector",
        status: "error",
        provider: provider.key,
        message: error instanceof Error ? error.message : "That connection could not be completed.",
      },
      origin,
    );
  }
}
