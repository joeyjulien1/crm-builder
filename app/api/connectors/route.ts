import { getSession } from "@/lib/auth/session";
import { connectorStates } from "@/lib/connectors/status";
import { describeSetupFailure } from "@/lib/setup-error";

/** Connection status for the signed-in user. Never returns a token. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });

  try {
    const states = await connectorStates(session.tenantId, session.userId);
    return Response.json({ connectors: states });
  } catch (error) {
    // A deployment whose migrations have not run fails here first, because
    // `connections` is the newest table. Say which knob is wrong rather than
    // letting the panel report that something went wrong.
    console.error("reading connections failed:", error);
    const setup = describeSetupFailure(error);
    return Response.json(
      { error: setup ?? "Connections could not be read." },
      { status: setup ? 503 : 500 },
    );
  }
}
