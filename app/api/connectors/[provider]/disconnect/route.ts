import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { connections } from "@/lib/db/schema";
import { disconnect } from "@/lib/connectors/oauth";
import { providerFor } from "@/lib/connectors/registry";

/**
 * Revokes at the provider, then drops the row. POST rather than GET because it
 * changes something, which also keeps it off a link a browser might prefetch.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });

  const { provider: key } = await params;
  if (!providerFor(key)) return new Response("No such connector.", { status: 404 });

  // Scoped to this user's own grant: an id from the client is never trusted to
  // name the row on its own.
  const [row] = await withTenant(session.tenantId, (db) =>
    db
      .select({ id: connections.id })
      .from(connections)
      .where(
        and(
          eq(connections.tenantId, session.tenantId),
          eq(connections.userId, session.userId),
          eq(connections.provider, key),
        ),
      )
      .limit(1),
  );

  if (!row) return Response.json({ disconnected: true, revoked: false });

  const result = await disconnect(session.tenantId, row.id);
  return Response.json({ disconnected: true, ...result });
}
