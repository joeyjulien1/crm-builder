import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { records } from "@/lib/db/schema";
import { getCurrentVersion } from "@/lib/config/version";

export const maxDuration = 60;

/** A portable config + records backup. Credentials and other tenants never enter the export. */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to download your workspace.", { status: 401 });
  const { config, version } = await withTenant(session.tenantId, (db) => getCurrentVersion(db, session.tenantId));
  const encoder = new TextEncoder();
  let cursor: string | undefined;
  let first = true;
  let cancelled = false;
  let started = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled || request.signal.aborted) { controller.close(); return; }
      try {
        if (!started) {
          const metadata = { format: "crm-studio-backup", formatVersion: 1, exportedAt: new Date().toISOString(), workspace: session.tenantName, configVersion: version, config };
          controller.enqueue(encoder.encode(JSON.stringify(metadata).slice(0, -1) + ',"records":['));
          started = true;
          return;
        }
        // A page is fetched only when the consumer is ready. Slow downloads do
        // not accumulate the whole workspace in memory or hold a DB connection.
        const batch = await withTenant(session.tenantId, (db) => db.select({ id: records.id, objectKey: records.objectKey, data: records.data, createdAt: records.createdAt, updatedAt: records.updatedAt })
          .from(records).where(and(eq(records.tenantId, session.tenantId), isNull(records.deletedAt), cursor ? gt(records.id, cursor) : undefined))
          .orderBy(asc(records.id)).limit(250));
        if (cancelled) return;
        if (batch.length) {
          controller.enqueue(encoder.encode((first ? "" : ",") + batch.map((record) => JSON.stringify(record)).join(",")));
          first = false;
          cursor = batch[batch.length - 1]!.id;
        }
        if (batch.length < 250) { controller.enqueue(encoder.encode("]}")); controller.close(); }
      } catch (error) { if (!cancelled) controller.error(error); }
    },
    cancel() { cancelled = true; },
  });
  return new Response(stream, { headers: {
    "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="crm-studio-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  } });
}
