import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { fileBytes, getUpload } from "@/lib/files";

/**
 * Serves a tenant's own upload: brand logos, record images, data files. The
 * read runs inside withTenant, so another tenant's id resolves to nothing
 * and fails closed with a 404 rather than a leak.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });

  const { id } = await params;
  const upload = await withTenant(session.tenantId, (db) => getUpload(db, session.tenantId, id));
  if (!upload) return new Response("That file does not exist.", { status: 404 });

  const bytes = fileBytes(upload);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": upload.mimeType || "application/octet-stream",
      "content-length": String(bytes.length),
      // Files are immutable once written; browsers may cache per tenant.
      "cache-control": "private, max-age=31536000, immutable",
      "content-disposition": `inline; filename="${upload.filename.replace(/"/g, "")}"`,
    },
  });
}
