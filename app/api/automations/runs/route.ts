import { and, desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { automationRuns } from "@/lib/db/schema";

/**
 * Recent runs. `automation_runs` has recorded every run's inputs, outputs,
 * errors and config version since the engine shipped, and nothing has ever
 * shown it — so a workflow that stopped working was invisible until someone
 * noticed the emails had stopped.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });

  const automationId = new URL(request.url).searchParams.get("automationId");

  const rows = await withTenant(session.tenantId, (db) =>
    db
      .select()
      .from(automationRuns)
      .where(
        automationId
          ? and(eq(automationRuns.tenantId, session.tenantId), eq(automationRuns.automationId, automationId))
          : eq(automationRuns.tenantId, session.tenantId),
      )
      .orderBy(desc(automationRuns.createdAt))
      .limit(25),
  );

  return Response.json({
    runs: rows.map((row) => ({
      id: row.id,
      automationId: row.automationId,
      status: row.status,
      error: row.error,
      depth: row.depth,
      configVersion: row.configVersion,
      createdAt: row.createdAt.toISOString(),
      recordId: (row.input as { recordId?: string }).recordId ?? null,
      steps: (row.output as { steps?: unknown[] }).steps ?? [],
    })),
  });
}
