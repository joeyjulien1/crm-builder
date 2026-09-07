import { getSession } from "@/lib/auth/session";
import { saveKeyConnection, validateCredentials } from "@/lib/connectors/credentials";
import { providerFor } from "@/lib/connectors/registry";

/**
 * Connects a provider that takes a key rather than a grant. The values are
 * encrypted on the way in and never read back out to a browser.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });

  const { provider: key } = await params;
  const provider = providerFor(key);
  if (!provider) return new Response("No such connector.", { status: 404 });

  const body = (await request.json().catch(() => null)) as { values?: Record<string, unknown> } | null;
  if (!body?.values) return new Response("There are no credentials to save.", { status: 400 });

  try {
    const values = validateCredentials(provider, body.values);
    const saved = await saveKeyConnection({
      tenantId: session.tenantId,
      userId: session.userId,
      provider,
      values,
    });
    return Response.json(saved);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "That connection could not be saved.", {
      status: 400,
    });
  }
}
