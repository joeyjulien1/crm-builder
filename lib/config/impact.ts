import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { records } from "@/lib/db/schema";
import { describePatch } from "./describe";
import { EXTERNAL_EFFECT_ACTIONS, flattenSteps } from "./schema";
import { findField } from "./patch";
import type { Config, ConfigPatch, ImpactItem, ImpactSummary } from "./types";

/**
 * What a patch would actually do to this tenant's data. ConfigDiff shows the
 * counts — "Removes Source from Contacts — 412 records have a value" — because
 * a destructive change without a number attached is not really reviewable.
 */
export async function computeImpact(
  db: Db,
  tenantId: string,
  config: Config,
  patches: ConfigPatch[],
): Promise<ImpactSummary> {
  const items: ImpactItem[] = [];

  for (const patch of patches) {
    const description = describePatch(patch, config);

    switch (patch.op) {
      case "remove_field": {
        const found = findField(config, patch.fieldId);
        const affected = found
          ? await countRecordsWithValue(db, tenantId, found.object.key, patch.fieldId)
          : 0;
        items.push({ description, destructive: true, externalEffect: false, affectedRecords: affected });
        break;
      }

      case "update_field": {
        const found = findField(config, patch.fieldId);
        if (!found || !patch.options) {
          items.push({ description, destructive: false, externalEffect: false });
          break;
        }
        const proposed = new Set(patch.options.map((o) => o.value));
        const removed = (found.field.options ?? []).filter((o) => !proposed.has(o.value));
        if (removed.length === 0) {
          items.push({ description, destructive: false, externalEffect: false });
          break;
        }
        const affected = await countRecordsWithValues(
          db,
          tenantId,
          found.object.key,
          patch.fieldId,
          removed.map((o) => o.value),
        );
        items.push({ description, destructive: true, externalEffect: false, affectedRecords: affected });
        break;
      }

      case "update_pipeline": {
        const pipeline = config.pipelines.find((p) => p.id === patch.pipelineId);
        if (!pipeline || !patch.stages) {
          items.push({ description, destructive: false, externalEffect: false });
          break;
        }
        const nextKeys = new Set(patch.stages.map((s) => s.key));
        const removed = pipeline.stages.filter((s) => !nextKeys.has(s.key));
        if (removed.length === 0) {
          items.push({ description, destructive: false, externalEffect: false });
          break;
        }
        const affected = await countRecordsWithValues(
          db,
          tenantId,
          pipeline.objectKey,
          pipeline.stageFieldId,
          removed.map((s) => s.key),
        );
        items.push({ description, destructive: true, externalEffect: false, affectedRecords: affected });
        break;
      }

      case "delete_screen":
      case "delete_view":
        items.push({ description, destructive: true, externalEffect: false });
        break;

      case "create_automation":
        items.push({
          description,
          destructive: false,
          externalEffect: flattenSteps(patch.automation.steps).some(isExternal),
        });
        break;

      case "update_automation":
        items.push({
          description,
          destructive: false,
          externalEffect: flattenSteps(patch.steps ?? []).some(isExternal) || (patch.actions ?? []).some(isExternal),
        });
        break;

      case "reset_to_blank": {
        // Records are not deleted, but their objects are, which puts every one
        // of them out of reach. That is the number worth showing before someone
        // starts over on a workspace that has data in it.
        const affected = await countAllRecords(db, tenantId);
        items.push({
          description,
          destructive: affected > 0,
          externalEffect: false,
          affectedRecords: affected,
        });
        break;
      }

      case "delete_object": {
        // Deleting an object leaves its rows orphaned rather than dropping
        // them, so the count is what the user is walking away from.
        const affected = await countRecordsOfObject(db, tenantId, patch.objectKey);
        items.push({ description, destructive: true, externalEffect: false, affectedRecords: affected });
        break;
      }

      case "set_automation_enabled": {
        const automation = config.automations.find((a) => a.id === patch.automationId);
        items.push({
          description,
          destructive: false,
          externalEffect: patch.enabled && flattenSteps(automation?.steps ?? []).some(isExternal),
        });
        break;
      }

      case "rollback":
        items.push({ description, destructive: true, externalEffect: false });
        break;

      default:
        items.push({ description, destructive: false, externalEffect: false });
    }
  }

  return {
    items,
    hasDestructive: items.some((i) => i.destructive),
    hasExternalEffects: items.some((i) => i.externalEffect),
  };
}

async function countAllRecords(db: Db, tenantId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(records)
    .where(eq(records.tenantId, tenantId));
  return row?.count ?? 0;
}

async function countRecordsOfObject(db: Db, tenantId: string, objectKey: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(records)
    .where(and(eq(records.tenantId, tenantId), eq(records.objectKey, objectKey)));
  return row?.count ?? 0;
}

function isExternal(step: { type: string }): boolean {
  return (EXTERNAL_EFFECT_ACTIONS as readonly string[]).includes(step.type);
}

async function countRecordsWithValue(
  db: Db,
  tenantId: string,
  objectKey: string,
  fieldId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(records)
    .where(
      and(
        eq(records.tenantId, tenantId),
        eq(records.objectKey, objectKey),
        sql`${records.deletedAt} is null`,
        sql`jsonb_exists(${records.data}, ${fieldId})`,
        sql`${records.data} -> ${fieldId} <> 'null'::jsonb`,
      ),
    );
  return row?.count ?? 0;
}

async function countRecordsWithValues(
  db: Db,
  tenantId: string,
  objectKey: string,
  fieldId: string,
  values: string[],
): Promise<number> {
  if (values.length === 0) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(records)
    .where(
      and(
        eq(records.tenantId, tenantId),
        eq(records.objectKey, objectKey),
        sql`${records.deletedAt} is null`,
        sql`${records.data} ->> ${fieldId} = any(array[${sql.join(
          values.map((value) => sql`${value}`),
          sql`, `,
        )}]::text[])`,
      ),
    );
  return row?.count ?? 0;
}
