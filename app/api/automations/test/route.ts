import { and, desc, eq, isNull } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { records } from "@/lib/db/schema";
import { getCurrentVersion } from "@/lib/config/version";
import { testAutomation } from "@/lib/automations/run";
import { titlesFor } from "@/lib/runtime/records";

/**
 * Runs a workflow against one real record and reports what each step would do,
 * without doing any of it. Nothing is written, nothing is sent, nothing is
 * called.
 *
 * A record is picked for you — the most recently updated one of the trigger's
 * object — because the question people actually have is "does this work at
 * all", and making them find a record first is a step between them and the
 * answer.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { automationId?: string; recordId?: string }
    | null;
  if (!body?.automationId) return new Response("There is no workflow to test.", { status: 400 });

  try {
    const picked = await withTenant(session.tenantId, async (db) => {
      const { config } = await getCurrentVersion(db, session.tenantId);
      const automation = config.automations.find((candidate) => candidate.id === body.automationId);
      if (!automation) return null;

      if (body.recordId) return { recordId: body.recordId, title: undefined as string | undefined };

      const [row] = await db
        .select({ id: records.id })
        .from(records)
        .where(
          and(
            eq(records.tenantId, session.tenantId),
            eq(records.objectKey, automation.trigger.objectKey),
            isNull(records.deletedAt),
          ),
        )
        .orderBy(desc(records.updatedAt))
        .limit(1);

      if (!row) return { recordId: null, objectKey: automation.trigger.objectKey };

      const titles = await titlesFor(db, session.tenantId, config, [row.id]);
      return { recordId: row.id, title: titles.get(row.id) };
    });

    if (!picked) return new Response("That workflow no longer exists.", { status: 404 });
    if (!picked.recordId) {
      return Response.json({
        reports: [],
        missingMergeFields: [],
        error: `There are no ${"objectKey" in picked ? picked.objectKey : "matching"} records to test against yet. Add one first.`,
      });
    }

    const result = await testAutomation({
      tenantId: session.tenantId,
      automationId: body.automationId,
      recordId: picked.recordId,
    });

    return Response.json({ ...result, recordId: picked.recordId, recordTitle: picked.title });
  } catch (error) {
    console.error("workflow test failed:", error);
    return new Response("That workflow could not be tested.", { status: 500 });
  }
}
