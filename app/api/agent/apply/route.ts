import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { commitPatches } from "@/lib/config/version";
import { describePatch } from "@/lib/config/describe";
import { parsePatch, PatchError } from "@/lib/config/patch";
import { checkScreenSource } from "@/lib/config/screen-source";
import { getCurrentVersion } from "@/lib/config/version";

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });
  if (!session.canEditConfig) {
    return new Response("Your role cannot change this workspace's configuration.", { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { patches?: unknown[]; author?: unknown }
    | null;
  if (!body || !Array.isArray(body.patches) || body.patches.length === 0 || body.patches.length > 256) {
    return new Response("There is nothing to apply.", { status: 400 });
  }

  // Both the agent and the backend editor commit through here, and change
  // history is worth nothing if it cannot tell them apart. The client says
  // which it is; the id comes from the session, never from the body.
  const author = body.author === "user" ? session.userId : "agent";

  try {
    const patches = body.patches.map(parsePatch);

    // A screen that does not parse must never reach the database, whichever
    // author wrote it. The agent is told before it stages; this is the same
    // check for the editor's own source box, and the last one before storage.
    for (const patch of patches) {
      const source =
        patch.op === "create_screen" ? patch.screen.source : patch.op === "update_screen" ? patch.source : undefined;
      if (!source) continue;
      const problem = checkScreenSource(source);
      if (problem) {
        return new Response(`That screen does not compile: ${problem}`, { status: 422 });
      }
    }

    const version = await withTenant(session.tenantId, async (db) => {
      const current = await getCurrentVersion(db, session.tenantId);
      const summary =
        patches.length === 1
          ? describePatch(patches[0]!, current.config)
          : `${patches.length} configuration changes`;

      const committed = await commitPatches(db, session.tenantId, patches, author, summary);

      return committed;
    });

    revalidatePath("/", "layout");

    return Response.json({
      version: version.version,
      summary: version.summary,
      config: version.config,
      firstViewId: version.config.views[0]?.id ?? null,
      firstScreenId: version.config.screens?.[0]?.id ?? null,
    });
  } catch (error) {
    if (error instanceof PatchError) return new Response(error.message, { status: 422 });
    console.error("apply failed:", error);
    return new Response("Those changes could not be applied.", { status: 500 });
  }
}
