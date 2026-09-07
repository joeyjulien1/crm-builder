"use server";

import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { records, viewPrefs } from "@/lib/db/schema";
import { getCurrentVersion, commitFullConfig, commitPatches } from "@/lib/config/version";
import { applyPatches, parsePatch, PatchError } from "@/lib/config/patch";
import { assertReadable, resolveTheme } from "@/lib/config/theme";
import { startingConfig } from "@/lib/config/default";
import type { Config, CrmRecord, FilterTree, ObjectKey, ScreenConfig, Sort } from "@/lib/config/types";
import { compileSearch } from "@/lib/runtime/query";
import { referencedRecordIds, resolveScreenData, type ScreenData } from "@/lib/runtime/screen";
import { resolveViewConfig, type ResolvedView } from "@/lib/runtime/view";
import {
  createRecord,
  listRecords,
  RecordError,
  titlesFor,
  updateRecord,
} from "@/lib/runtime/records";
import { dispatchRecordEvent } from "@/lib/automations/dispatch";
import { getProject } from "@/lib/projects";
import { configSchema, filterTreeSchema, sortSchema } from "@/lib/config/schema";
import { isUuid } from "@/lib/files";

export interface ActionError {
  message: string;
  fieldErrors?: Record<string, string>;
}

export async function listRecordsAction(
  viewId: string,
  options: { sort?: Sort; filters?: FilterTree; search?: string; offset?: number },
): Promise<{ records: CrmRecord[]; total: number; titles: Record<string, string> }> {
  const session = await requireSession();

  return withTenant(session.tenantId, async (db) => {
    const { config } = await getCurrentVersion(db, session.tenantId);
    const view = config.views.find((candidate) => candidate.id === viewId);
    if (!view) throw new Error("That view no longer exists.");

    const page = await listRecords(
      db,
      session.tenantId,
      config,
      { ...view, sort: options.sort ?? view.sort, filters: options.filters ?? view.filters },
      { search: options.search, offset: options.offset, limit: 500 },
    );

    const object = config.objects.find((candidate) => candidate.key === view.objectKey);
    const relationFieldIds = (object?.fields ?? [])
      .filter((field) => field.type === "relation")
      .map((field) => field.id);

    const referenced = page.records.flatMap((record) =>
      relationFieldIds.map((fieldId) => record.data[fieldId]).filter(Boolean).map(String),
    );
    const titles = await titlesFor(db, session.tenantId, config, referenced);

    return { ...page, titles: Object.fromEntries(titles) };
  });
}

/**
 * Records for one object, for a screen the agent wrote as code.
 *
 * A coded screen names an object and a filter tree; it never names a table, a
 * column or a predicate. Everything below is compiled by `planViewQuery` from
 * the same typed structure the config-driven views use, inside `withTenant`, so
 * a generated screen reaches exactly as far into the database as a hand-built
 * one and no further. The filter tree is parsed before it is used — the browser
 * is not trusted to have sent a legal one.
 */
export async function queryRecordsAction(
  objectKey: string,
  options: { filters?: unknown; sort?: unknown; search?: string; limit?: number; offset?: number } = {},
): Promise<{ records: CrmRecord[]; total: number; titles: Record<string, string> }> {
  const session = await requireSession();

  return withTenant(session.tenantId, async (db) => {
    const { config } = await getCurrentVersion(db, session.tenantId);
    const object = config.objects.find((candidate) => candidate.key === objectKey);
    if (!object) throw new Error(`There is no ${objectKey} object in this workspace.`);

    const filters = options.filters ? filterTreeSchema.parse(options.filters) : undefined;
    const sort = options.sort ? sortSchema.parse(options.sort) : undefined;

    const page = await listRecords(
      db,
      session.tenantId,
      config,
      {
        id: `coded:${object.key}`,
        objectKey: object.key,
        name: object.labelPlural,
        renderer: "table",
        columns: [],
        filters,
        sort,
      },
      {
        search: options.search,
        offset: options.offset,
        limit: Math.min(Math.max(options.limit ?? 100, 1), 500),
      },
    );

    const relationFieldIds = object.fields
      .filter((field) => field.type === "relation")
      .map((field) => field.id);
    const referenced = page.records.flatMap((record) =>
      relationFieldIds.map((fieldId) => record.data[fieldId]).filter(Boolean).map(String),
    );
    const titles = await titlesFor(db, session.tenantId, config, referenced);

    return { ...page, titles: Object.fromEntries(titles) };
  });
}

export async function updateRecordFieldAction(
  recordId: string,
  fieldId: string,
  value: unknown,
): Promise<{ ok: true } | ActionError> {
  const session = await requireSession();

  try {
    const outcome = await withTenant(session.tenantId, async (db) => {
      const { config, version } = await getCurrentVersion(db, session.tenantId);
      return {
        result: await updateRecord(db, session.tenantId, config, recordId, { [fieldId]: value }, session.email),
        version,
      };
    });

    await dispatchRecordEvent({
      tenantId: session.tenantId,
      recordId,
      kind: "record_updated",
      changedFieldIds: outcome.result.changedFieldIds,
      configVersion: outcome.version,
    });

    revalidatePath("/views/[viewId]", "page");
    return { ok: true };
  } catch (error) {
    if (error instanceof RecordError) {
      return { message: error.message, fieldErrors: error.fieldErrors };
    }
    throw error;
  }
}

export async function createRecordAction(
  objectKey: ObjectKey,
  values: Record<string, unknown>,
): Promise<{ ok: true; id: string } | ActionError> {
  const session = await requireSession();

  try {
    const created = await withTenant(session.tenantId, async (db) => {
      const { config, version } = await getCurrentVersion(db, session.tenantId);
      const record = await createRecord(db, session.tenantId, config, objectKey, values, session.email);
      return { record, version };
    });

    await dispatchRecordEvent({
      tenantId: session.tenantId,
      recordId: created.record.id,
      kind: "record_created",
      changedFieldIds: Object.keys(values),
      configVersion: created.version,
    });

    revalidatePath("/views/[viewId]", "page");
    return { ok: true, id: created.record.id };
  } catch (error) {
    if (error instanceof RecordError) {
      return { message: error.message, fieldErrors: error.fieldErrors };
    }
    throw error;
  }
}

/** Column widths are a per-user preference, not configuration. */
export async function saveColumnWidthsAction(
  viewId: string,
  columnWidths: Record<string, number>,
): Promise<void> {
  const session = await requireSession();

  await withTenant(session.tenantId, (db) =>
    db
      .insert(viewPrefs)
      .values({ tenantId: session.tenantId, userId: session.userId, viewId, columnWidths })
      .onConflictDoUpdate({
        target: [viewPrefs.tenantId, viewPrefs.userId, viewPrefs.viewId],
        set: { columnWidths },
      }),
  );
}

export async function searchRecordsAction(
  query: string,
): Promise<{ id: string; title: string; objectKey: ObjectKey }[]> {
  const session = await requireSession();
  const term = query.trim();
  if (term.length < 2) return [];

  return withTenant(session.tenantId, async (db) => {
    const { config } = await getCurrentVersion(db, session.tenantId);

    const perObject: SQL[] = [];
    for (const object of config.objects) {
      const search = compileSearch(config, object.key, term);
      if (search) perObject.push(and(eq(records.objectKey, object.key), search)!);
    }
    if (perObject.length === 0) return [];

    const rows = await db
      .select({ id: records.id, objectKey: records.objectKey, data: records.data })
      .from(records)
      .where(and(eq(records.tenantId, session.tenantId), isNull(records.deletedAt), or(...perObject)))
      .orderBy(sql`${records.updatedAt} desc`)
      .limit(20);

    const titleFieldByObject = new Map(
      config.objects.map((object) => [object.key, object.titleFieldId ?? object.fields[0]?.id]),
    );

    return rows.map((row) => {
      const objectKey = row.objectKey as ObjectKey;
      const titleFieldId = titleFieldByObject.get(objectKey);
      const title = titleFieldId ? row.data[titleFieldId] : undefined;
      return { id: row.id, objectKey, title: title ? String(title) : "Untitled" };
    });
  });
}

export async function updateBrandAction(brand: {
  name: string;
  tagline?: string;
  logoText: string;
  accentColor?: string;
}): Promise<{ success: boolean; error?: string }> {
  const session = await requireSession();
  if (!session.canEditConfig) {
    return { success: false, error: "Permission denied." };
  }

  try {
    await withTenant(session.tenantId, async (db) => {
      const current = await getCurrentVersion(db, session.tenantId);
      const updatedConfig = {
        ...current.config,
        brand: {
          name: brand.name,
          tagline: brand.tagline,
          logoText: brand.logoText,
          accentColor: brand.accentColor ?? "#ffffff",
          theme: current.config.brand?.theme ?? "dark",
          layoutStyle: current.config.brand?.layoutStyle ?? "default",
          kpis: current.config.brand?.kpis,
        },
      };
      await commitFullConfig(db, session.tenantId, updatedConfig, session.userId, `Brand updated: ${brand.name}`);
    });
    revalidatePath("/", "layout");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to update brand." };
  }
}

/**
 * Applies a theme change made by hand rather than by the agent.
 *
 * It goes through the same patch path the agent uses, so a change made in the
 * editor is validated, versioned and reversible exactly like a generated one —
 * and the two can be interleaved without either clobbering the other.
 */
export async function updateThemeAction(
  theme: unknown,
): Promise<{ success: boolean; error?: string; problems?: string[] }> {
  const session = await requireSession();
  if (!session.canEditConfig) {
    return { success: false, error: "Your role cannot change this workspace's configuration." };
  }

  try {
    const patch = parsePatch({ op: "update_theme", theme });

    // The same readability floor the agent is held to.
    const problems = await withTenant(session.tenantId, async (db) => {
      const current = await getCurrentVersion(db, session.tenantId);
      const next = applyPatches(current.config, [patch]);
      return assertReadable(resolveTheme(next.theme));
    });

    if (problems.length > 0) return { success: false, error: problems[0], problems };

    await withTenant(session.tenantId, (db) =>
      commitPatches(db, session.tenantId, [patch], session.email, "Theme edited"),
    );
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    if (error instanceof PatchError) return { success: false, error: error.message };
    return { success: false, error: error instanceof Error ? error.message : "Could not save the theme." };
  }
}

export async function addCustomAgentAction(agent: {
  name: string;
  role: string;
  description: string;
  instructions: string;
  avatar?: string;
  enabled?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const session = await requireSession();
  if (!session.canEditConfig) {
    return { success: false, error: "Permission denied." };
  }

  try {
    await withTenant(session.tenantId, async (db) => {
      const current = await getCurrentVersion(db, session.tenantId);
      const existing = current.config.customAgents ?? [];
      const newAgent = {
        id: `agent_${Math.random().toString(36).slice(2, 10)}`,
        name: agent.name,
        role: agent.role,
        description: agent.description,
        instructions: agent.instructions,
        avatar: agent.avatar || "Bot",
        enabled: agent.enabled !== false,
      };
      const updatedConfig = {
        ...current.config,
        customAgents: [...existing, newAgent],
      };
      await commitFullConfig(db, session.tenantId, updatedConfig, session.userId, `Added custom agent: ${agent.name}`);
    });
    revalidatePath("/", "layout");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to add custom agent." };
  }
}

export async function removeCustomAgentAction(agentId: string): Promise<{ success: boolean; error?: string }> {
  const session = await requireSession();
  if (!session.canEditConfig) {
    return { success: false, error: "Permission denied." };
  }

  try {
    await withTenant(session.tenantId, async (db) => {
      const current = await getCurrentVersion(db, session.tenantId);
      const existing = current.config.customAgents ?? [];
      const updatedConfig = {
        ...current.config,
        customAgents: existing.filter((a) => a.id !== agentId),
      };
      await commitFullConfig(db, session.tenantId, updatedConfig, session.userId, `Removed custom agent`);
    });
    revalidatePath("/", "layout");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to remove custom agent." };
  }
}

/**
 * Starts a genuinely new project: the default schema, no screens, no pipelines,
 * no relations, no assistants, and the default theme. Committed as one
 * reversible patch, so an accidental reset is one rollback away.
 */
export async function resetToBlankAction(): Promise<{ success: boolean; error?: string }> {
  const session = await requireSession();
  if (!session.canEditConfig) {
    return { success: false, error: "Permission denied." };
  }

  try {
    await withTenant(session.tenantId, (db) =>
      commitPatches(
        db,
        session.tenantId,
        [{ op: "reset_to_blank", config: startingConfig() }],
        session.email,
        "Started a new project",
      ),
    );
    revalidatePath("/", "layout");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Could not start a new project." };
  }
}

/**
 * Reads the CRM the agent built so the builder can render it inline in the
 * center canvas — no route change, no new page.
 *
 * Read-only: it resolves the first generated screen (else the first view) and
 * its records through the same resolvers the full pages use
 * (`lib/runtime/screen.ts`, `lib/runtime/view.ts`), inside `withTenant`, so
 * RLS still separates tenants. Pass an explicit screen or view id to switch
 * tabs inside the preview.
 */
export interface BuilderCrmState {
  config: Config;
  activeKind: "screen" | "view" | null;
  screen?: ScreenConfig;
  screenData?: ScreenData & { titles: Record<string, string> };
  resolvedView?: ResolvedView;
  records?: CrmRecord[];
  total?: number;
  titles?: Record<string, string>;
  columnWidths?: Record<string, number>;
  error?: string;
}

export async function getBuilderCrmAction(
  selection?: { screenId?: string; viewId?: string },
): Promise<BuilderCrmState> {
  const session = await requireSession();

  return withTenant(session.tenantId, async (db) => {
    const { config } = await getCurrentVersion(db, session.tenantId);

    try {
      const screens = [...(config.screens ?? [])].sort((a, b) => a.position - b.position);
      const screen =
        (selection?.screenId && screens.find((candidate) => candidate.id === selection.screenId)) ??
        screens[0];

      // Generated screens come first — they are the CRM the agent built.
      if (screen) {
        const data = await resolveScreenData(db, session.tenantId, config, screen);
        const referenced = referencedRecordIds(config, data, screen);
        const titles = await titlesFor(db, session.tenantId, config, referenced);
        const titleMap = Object.fromEntries(titles);
        return {
          config,
          activeKind: "screen",
          screen,
          screenData: { ...data, titles: titleMap },
          titles: titleMap,
        };
      }

      const view =
        (selection?.viewId && config.views.find((candidate) => candidate.id === selection.viewId)) ??
        config.views[0];
      if (!view) return { config, activeKind: null };

      const resolved = resolveViewConfig(config, view);
      const page = await listRecords(db, session.tenantId, config, view, { limit: 200 });

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
            eq(viewPrefs.viewId, view.id),
          ),
        )
        .limit(1);

      return {
        config,
        activeKind: "view",
        resolvedView: resolved,
        records: page.records,
        total: page.total,
        titles: Object.fromEntries(titles),
        columnWidths: prefs?.columnWidths ?? {},
      };
    } catch (error) {
      return {
        config,
        activeKind: null,
        error: error instanceof Error ? error.message : "That CRM could not be loaded.",
      };
    }
  });
}

/**
 * Opens a saved project: its snapshot is validated and written forward as a
 * new config version — exactly like a rollback, so the current workspace is
 * never destroyed by going back.
 */
export async function openProjectAction(projectId: string): Promise<{ success: boolean; error?: string }> {
  const session = await requireSession();
  if (!session.canEditConfig) {
    return { success: false, error: "Your role can review changes but not open projects." };
  }

  try {
    await withTenant(session.tenantId, async (db) => {
      if (!isUuid(projectId)) throw new PatchError("That project does not exist.");
      const project = await getProject(db, session.tenantId, projectId);
      if (!project) throw new PatchError("That project does not exist.");
      const parsed = configSchema.safeParse(project.config);
      if (!parsed.success) throw new PatchError("That project is no longer valid.");
      await commitFullConfig(db, session.tenantId, parsed.data, session.userId, `Opened project: ${project.name}`);
    });
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    if (error instanceof PatchError) return { success: false, error: error.message };
    return { success: false, error: error instanceof Error ? error.message : "That project could not be opened." };
  }
}




