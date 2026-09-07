import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { getCurrentVersion } from "@/lib/config/version";
import { referencedRecordIds, resolveScreenData } from "@/lib/runtime/screen";
import { titlesFor } from "@/lib/runtime/records";
import { ScreenSurface } from "@/components/screens/ScreenSurface";

/**
 * A generated screen. The tree comes from config, the records come from the
 * tenant's own rows, and the two are joined here rather than in the browser —
 * so nothing about what a screen may read is decided on the client.
 */
export default async function ScreenPage({ params }: { params: Promise<{ screenId: string }> }) {
  const { screenId } = await params;
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const loaded = await withTenant(session.tenantId, async (db) => {
    const { config } = await getCurrentVersion(db, session.tenantId);
    const screen = (config.screens ?? []).find((candidate) => candidate.id === screenId);
    if (!screen) return null;

    const data = await resolveScreenData(db, session.tenantId, config, screen);

    // Relation columns show a name, not an id.
    const referenced = referencedRecordIds(config, data, screen);
    const titles = await titlesFor(db, session.tenantId, config, referenced);

    return { config, screen, data: { ...data, titles: Object.fromEntries(titles) } };
  });

  if (!loaded) notFound();

  return <ScreenSurface screen={loaded.screen} config={loaded.config} data={loaded.data} />;
}
