import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { saveUpload, uploadUrl, validateUpload } from "@/lib/files";

/**
 * Stores a user upload (an image for the agent to see, or a data file for
 * import) as a tenant-scoped files row. The write runs inside withTenant, so
 * RLS stamps it to the caller — a tenant id in the body would be ignored.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("That upload could not be read.", { status: 400 });
  }

  const payload = (body ?? {}) as { filename?: unknown; mimeType?: unknown; data?: unknown };
  const validated = validateUpload(payload);
  if (!validated.ok) return new Response(validated.error, { status: 400 });

  const saved = await withTenant(session.tenantId, (db) =>
    saveUpload(db, session.tenantId, validated.upload),
  );

  return Response.json({ url: uploadUrl(saved.id), ...saved });
}
