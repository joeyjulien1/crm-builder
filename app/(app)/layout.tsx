import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getConfig } from "@/lib/config/version";
import { listProjects } from "@/lib/projects";
import { withTenant } from "@/lib/db/client";
import { countByObject } from "@/lib/runtime/records";
import { themeAttributes, themeVars } from "@/lib/config/theme";
import { AppShell } from "./AppShell";

/**
 * The product runs at app density: 34px rows, borders rather than shadows.
 * `data-density` is set once, here, and nothing below it uses a raw px value.
 *
 * The server theme is the initial fallback and prevents a flash before the
 * client shell mounts. AppShell then establishes two explicit boundaries: its
 * Studio chrome and Backend use the fixed product theme, while the frontend
 * preview re-applies this tenant theme around the generated CRM only.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const [config, workspace] = await Promise.all([
    getConfig(session.tenantId),
    withTenant(session.tenantId, async (db) => ({
      counts: await countByObject(db, session.tenantId),
      projects: await listProjects(db, session.tenantId),
    })),
  ]);
  const { counts, projects } = workspace;

  return (
    <div
      {...themeAttributes(config.theme)}
      style={themeVars(config.theme) as React.CSSProperties}
      className="h-screen bg-surface text-content"
    >
      <AppShell session={session} config={config} counts={counts} projects={projects}>
        {children}
      </AppShell>
    </div>
  );
}
