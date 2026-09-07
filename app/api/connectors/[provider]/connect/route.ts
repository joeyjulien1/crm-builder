import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { authorizeUrl } from "@/lib/connectors/oauth";
import { providerFor } from "@/lib/connectors/registry";

/**
 * Starts the grant. Opened in a popup, so the agent conversation behind it
 * stays exactly where it was.
 *
 * The state cookie is what makes the callback verifiable as ours. It is bound
 * to the provider as well as the value, so a callback for one provider cannot
 * be replayed against another.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });

  const { provider: key } = await params;
  const provider = providerFor(key);
  if (!provider) return new Response("No such connector.", { status: 404 });

  const state = randomBytes(32).toString("hex");
  const store = await cookies();
  store.set(`connector_state_${provider.key}`, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  try {
    return Response.redirect(authorizeUrl(provider, state), 302);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "That connector is not configured.", {
      status: 500,
    });
  }
}
