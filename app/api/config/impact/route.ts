import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { computeImpact } from "@/lib/config/impact";
import { getCurrentVersion } from "@/lib/config/version";
import { parsePatch, PatchError } from "@/lib/config/patch";

/**
 * What a change would do to this workspace's data, before it is made.
 *
 * The agent gets this through ConfigDiff. The backend editor needs the same
 * number for the same reason: "Remove Source" and "Remove Source — 412 records
 * have a value" are different decisions, and only one of them is reviewable.
 * Nothing is applied here.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });

  const body = (await request.json().catch(() => null)) as { patches?: unknown[] } | null;
  if (!body || !Array.isArray(body.patches) || body.patches.length === 0 || body.patches.length > 64) {
    return new Response("There is nothing to check.", { status: 400 });
  }

  try {
    const patches = body.patches.map(parsePatch);
    const impact = await withTenant(session.tenantId, async (db) => {
      const current = await getCurrentVersion(db, session.tenantId);
      return computeImpact(db, session.tenantId, current.config, patches);
    });
    return Response.json(impact);
  } catch (error) {
    if (error instanceof PatchError) return new Response(error.message, { status: 422 });
    console.error("impact failed:", error);
    return new Response("That change could not be checked.", { status: 500 });
  }
}
