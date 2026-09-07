import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { withTenant } from "@/lib/db/client";
import { configVersions, records } from "@/lib/db/schema";
import { startingConfig } from "./default";
import { applyPatches, findField, PatchError } from "./patch";
import { hydrateConfig } from "./hydrate";
import type { Config, ConfigPatch } from "./types";

export interface ConfigVersion {
  id: string;
  version: number;
  config: Config;
  patch: ConfigPatch[];
  author: string;
  summary: string;
  createdAt: Date;
}

/** Reads the tenant's current config, seeding the default on first use. */
export async function getCurrentVersion(db: Db, tenantId: string): Promise<ConfigVersion> {
  const [row] = await db
    .select()
    .from(configVersions)
    .where(eq(configVersions.tenantId, tenantId))
    .orderBy(desc(configVersions.version))
    .limit(1);

  if (row) {
    return {
      id: row.id,
      version: row.version,
      config: hydrateConfig(row.config),
      patch: row.patch,
      author: row.author,
      summary: row.summary,
      createdAt: row.createdAt,
    };
  }

  // Two requests can reach a brand new tenant at once — a layout and its page,
  // say. Whichever loses the race reads the version the winner wrote.
  const [seeded] = await db
    .insert(configVersions)
    .values({
      tenantId,
      version: 1,
      parentId: null,
      config: startingConfig(),
      patch: [],
      author: "system",
      summary: "Starting configuration",
    })
    .onConflictDoNothing({ target: [configVersions.tenantId, configVersions.version] })
    .returning();

  if (seeded) {
    return {
      id: seeded.id,
      version: seeded.version,
      config: hydrateConfig(seeded.config),
      patch: seeded.patch,
      author: seeded.author,
      summary: seeded.summary,
      createdAt: seeded.createdAt,
    };
  }

  const [existing] = await db
    .select()
    .from(configVersions)
    .where(eq(configVersions.tenantId, tenantId))
    .orderBy(desc(configVersions.version))
    .limit(1);

  if (!existing) throw new Error("Could not read the starting configuration");
  return {
    id: existing.id,
    version: existing.version,
    config: hydrateConfig(existing.config),
    patch: existing.patch,
    author: existing.author,
    summary: existing.summary,
    createdAt: existing.createdAt,
  };
}

export async function getConfig(tenantId: string): Promise<Config> {
  return withTenant(tenantId, async (db) => (await getCurrentVersion(db, tenantId)).config);
}

/**
 * Applies a set of patches as one new immutable version. Nothing is edited in
 * place: a change that cannot be rolled back is a bug.
 */
export async function commitPatches(
  db: Db,
  tenantId: string,
  patches: ConfigPatch[],
  author: string,
  summary: string,
): Promise<ConfigVersion> {
  if (patches.length === 0) throw new PatchError("There is nothing to apply");

  const current = await getCurrentVersion(db, tenantId);
  const nextConfig = applyPatches(current.config, patches);

  await migrateStageValues(db, tenantId, current.config, patches);

  const [row] = await db
    .insert(configVersions)
    .values({
      tenantId,
      version: current.version + 1,
      parentId: current.id,
      config: nextConfig,
      patch: patches,
      author,
      summary,
    })
    .returning();

  if (!row) throw new Error("Could not write the new configuration version");
  return {
    id: row.id,
    version: row.version,
    config: hydrateConfig(row.config),
    patch: row.patch,
    author: row.author,
    summary: row.summary,
    createdAt: row.createdAt,
  };
}

/**
 * Commits a complete new config (e.g. from an industry template) as a new immutable version.
 */
export async function commitFullConfig(
  db: Db,
  tenantId: string,
  newConfig: Config,
  author: string,
  summary: string,
): Promise<ConfigVersion> {
  const current = await getCurrentVersion(db, tenantId);
  const [row] = await db
    .insert(configVersions)
    .values({
      tenantId,
      version: current.version + 1,
      parentId: current.id,
      config: newConfig,
      patch: [],
      author,
      summary,
    })
    .returning();

  if (!row) throw new Error("Could not write the template configuration version");
  return {
    id: row.id,
    version: row.version,
    config: hydrateConfig(row.config),
    patch: row.patch,
    author: row.author,
    summary: row.summary,
    createdAt: row.createdAt,
  };
}

/**
 * Rollback is a forward operation: version N is written again as version N+2.
 * No row is ever deleted or mutated, so the history stays a true record.
 */
export async function rollbackTo(
  db: Db,
  tenantId: string,
  targetVersion: number,
  author: string,
): Promise<ConfigVersion> {
  const [target] = await db
    .select()
    .from(configVersions)
    .where(and(eq(configVersions.tenantId, tenantId), eq(configVersions.version, targetVersion)))
    .limit(1);

  if (!target) throw new PatchError(`There is no version ${targetVersion} to roll back to`);

  const current = await getCurrentVersion(db, tenantId);
  if (current.version === targetVersion) return current;

  const patch: ConfigPatch[] = [{ op: "rollback", toVersion: targetVersion, config: target.config }];

  const [row] = await db
    .insert(configVersions)
    .values({
      tenantId,
      version: current.version + 1,
      parentId: current.id,
      config: target.config,
      patch,
      author,
      summary: `Rolled back to version ${targetVersion}`,
    })
    .returning();

  if (!row) throw new Error("Could not write the rollback version");
  return {
    id: row.id,
    version: row.version,
    config: hydrateConfig(row.config),
    patch: row.patch,
    author: row.author,
    summary: row.summary,
    createdAt: row.createdAt,
  };
}

export async function getHistory(db: Db, tenantId: string, limit = 20): Promise<ConfigVersion[]> {
  const rows = await db
    .select()
    .from(configVersions)
    .where(eq(configVersions.tenantId, tenantId))
    .orderBy(desc(configVersions.version))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    config: hydrateConfig(row.config),
    patch: row.patch,
    author: row.author,
    summary: row.summary,
    createdAt: row.createdAt,
  }));
}

/**
 * A pipeline patch that drops a stage carries where those records go. Moving
 * them is a data change, so it happens here, in the same transaction that
 * writes the version that assumes it already happened.
 */
async function migrateStageValues(
  db: Db,
  tenantId: string,
  config: Config,
  patches: ConfigPatch[],
): Promise<void> {
  for (const patch of patches) {
    if (patch.op !== "update_pipeline" || !patch.stageMigrations?.length) continue;

    const pipeline = config.pipelines.find((p) => p.id === patch.pipelineId);
    if (!pipeline) continue;
    const found = findField(config, pipeline.stageFieldId);
    if (!found) continue;

    for (const migration of patch.stageMigrations) {
      await db
        .update(records)
        .set({
          data: sql`jsonb_set(${records.data}, ${`{${pipeline.stageFieldId}}`}, ${JSON.stringify(migration.to)}::jsonb)`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(records.tenantId, tenantId),
            eq(records.objectKey, pipeline.objectKey),
            sql`${records.data} ->> ${pipeline.stageFieldId} = ${migration.from}`,
          ),
        );
    }
  }
}
