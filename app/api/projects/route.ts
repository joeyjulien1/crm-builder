import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { configSchema } from "@/lib/config/schema";
import { listProjects, saveProject } from "@/lib/projects";

/** Lists this tenant's saved generations, newest first — summaries only. */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });

  const projects = await withTenant(session.tenantId, (db) => listProjects(db, session.tenantId));
  return Response.json({ projects });
}

/**
 * Snapshots a finished generation as a project. The config must parse as a
 * Config — anything else is a 400, never a corrupt row.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });
  if (!session.canEditConfig) {
    return new Response("Your role can review changes but not save projects.", { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("That project could not be read.", { status: 400 });
  }

  const payload = (body ?? {}) as { name?: unknown; prompt?: unknown; config?: unknown };
  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 80) : "";
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim().slice(0, 2000) : "";
  if (!name || !prompt) return new Response("A project needs a name and its prompt.", { status: 400 });

  const parsed = configSchema.safeParse(payload.config);
  if (!parsed.success) return new Response("That configuration is not valid.", { status: 400 });

  // The id is minted server-side; a client-supplied one would collide.
  const project = await withTenant(session.tenantId, (db) =>
    saveProject(db, session.tenantId, { name, prompt, config: parsed.data }),
  );
  return Response.json({ project });
}
