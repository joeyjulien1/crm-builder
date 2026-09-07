import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { viewPrefs } from "@/lib/db/schema";
import { getCurrentVersion } from "@/lib/config/version";
import { resolveViewConfig, ViewError } from "@/lib/runtime/view";
import { listRecords, titlesFor } from "@/lib/runtime/records";
import { ViewScreen } from "./ViewScreen";

export default async function ViewPage({ params }: { params: Promise<{ viewId: string }> }) {
  const { viewId } = await params;
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const data = await withTenant(session.tenantId, async (db) => {
    const { config } = await getCurrentVersion(db, session.tenantId);
    const view = config.views.find((candidate) => candidate.id === viewId);
    if (!view) return null;

    const resolved = resolveViewConfig(config, view);
    const page = await listRecords(db, session.tenantId, config, view, { limit: 500 });

    const object = config.objects.find((candidate) => candidate.key === view.objectKey);
    const relationFieldIds = (object?.fields ?? [])
      .filter((field) => field.type === "relation")
      .map((field) => field.id);
    const referenced = page.records.flatMap((record) =>
      relationFieldIds.map((fieldId) => record.data[fieldId]).filter(Boolean).map(String),
    );
    const titles = await titlesFor(db, session.tenantId, config, referenced);

    const [prefs] = await db
      .select()
      .from(viewPrefs)
      .where(
        and(
          eq(viewPrefs.tenantId, session.tenantId),
          eq(viewPrefs.userId, session.userId),
          eq(viewPrefs.viewId, viewId),
        ),
      )
      .limit(1);

    return {
      config,
      resolved,
      page,
      titles: Object.fromEntries(titles),
      columnWidths: prefs?.columnWidths ?? {},
    };
  });

  if (!data) notFound();

  try {
    return (
      <ViewScreen
        resolved={data.resolved}
        config={data.config}
        initialRecords={data.page.records}
        initialTotal={data.page.total}
        initialTitles={data.titles}
        columnWidths={data.columnWidths}
      />
    );
  } catch (error) {
    if (error instanceof ViewError) notFound();
    throw error;
  }
}
