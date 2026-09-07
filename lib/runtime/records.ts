import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { activityEntries, records } from "@/lib/db/schema";
import { findObject } from "@/lib/config/patch";
import type { Config, CrmRecord, ObjectKey, ViewConfig } from "@/lib/config/types";
import { coerceValue, validateRecord } from "./field";
import { planViewQuery, type QueryOptions } from "./query";

export class RecordError extends Error {
  readonly fieldErrors: Record<string, string>;
  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "RecordError";
    this.fieldErrors = fieldErrors;
  }
}

export interface RecordPage {
  records: CrmRecord[];
  total: number;
}

function toCrmRecord(row: {
  id: string;
  objectKey: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}): CrmRecord {
  return {
    id: row.id,
    objectKey: row.objectKey as ObjectKey,
    data: row.data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listRecords(
  db: Db,
  tenantId: string,
  config: Config,
  view: ViewConfig,
  options: QueryOptions = {},
): Promise<RecordPage> {
  const plan = planViewQuery(config, view, tenantId, options);

  const rows = await db
    .select()
    .from(records)
    .where(plan.where)
    .orderBy(plan.orderBy, records.id)
    .limit(plan.limit)
    .offset(plan.offset);

  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(records)
    .where(plan.where);

  return { records: rows.map(toCrmRecord), total: counted?.count ?? 0 };
}

export async function getRecord(db: Db, tenantId: string, id: string): Promise<CrmRecord | null> {
  const [row] = await db
    .select()
    .from(records)
    .where(and(eq(records.tenantId, tenantId), eq(records.id, id), isNull(records.deletedAt)))
    .limit(1);
  return row ? toCrmRecord(row) : null;
}

/** Counts per object, for the agent's schema summary and empty states. */
export async function countByObject(db: Db, tenantId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ objectKey: records.objectKey, count: sql<number>`count(*)::int` })
    .from(records)
    .where(and(eq(records.tenantId, tenantId), isNull(records.deletedAt)))
    .groupBy(records.objectKey);

  return Object.fromEntries(rows.map((row) => [row.objectKey, row.count]));
}

function prepare(
  config: Config,
  objectKey: string,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const object = findObject(config, objectKey);
  if (!object) throw new RecordError(`There is no ${objectKey} object`);

  const byId = new Map(object.fields.map((field) => [field.id, field]));
  const prepared: Record<string, unknown> = {};

  for (const [fieldId, raw] of Object.entries(values)) {
    const field = byId.get(fieldId);
    if (!field) continue; // A field the config no longer has is simply dropped.
    prepared[fieldId] = coerceValue(field, raw);
  }

  return prepared;
}

export async function createRecord(
  db: Db,
  tenantId: string,
  config: Config,
  objectKey: ObjectKey,
  values: Record<string, unknown>,
  actor: string,
): Promise<CrmRecord> {
  const object = findObject(config, objectKey);
  if (!object) throw new RecordError(`There is no ${objectKey} object`);

  const data = prepare(config, objectKey, values);
  const errors = validateRecord(object.fields, data);
  if (Object.keys(errors).length > 0) {
    throw new RecordError(`This ${object.label.toLowerCase()} is missing something`, errors);
  }

  const [row] = await db.insert(records).values({ tenantId, objectKey, data }).returning();
  if (!row) throw new RecordError("Could not save this record");

  await db.insert(activityEntries).values({
    tenantId,
    recordId: row.id,
    kind: "created",
    actor,
    detail: {},
  });

  return toCrmRecord(row);
}

export interface UpdateResult {
  record: CrmRecord;
  changedFieldIds: string[];
  previous: Record<string, unknown>;
}

export async function updateRecord(
  db: Db,
  tenantId: string,
  config: Config,
  id: string,
  values: Record<string, unknown>,
  actor: string,
): Promise<UpdateResult> {
  const existing = await getRecord(db, tenantId, id);
  if (!existing) throw new RecordError("That record no longer exists");

  const object = findObject(config, existing.objectKey);
  if (!object) throw new RecordError(`There is no ${existing.objectKey} object`);

  const patch = prepare(config, existing.objectKey, values);
  const merged = { ...existing.data, ...patch };

  const errors = validateRecord(object.fields, merged);
  const touched = Object.keys(patch);
  const relevant = Object.fromEntries(
    Object.entries(errors).filter(([fieldId]) => touched.includes(fieldId)),
  );
  if (Object.keys(relevant).length > 0) {
    throw new RecordError("That change could not be saved", relevant);
  }

  const changedFieldIds = touched.filter(
    (fieldId) => JSON.stringify(existing.data[fieldId]) !== JSON.stringify(merged[fieldId]),
  );

  if (changedFieldIds.length === 0) {
    return { record: existing, changedFieldIds: [], previous: existing.data };
  }

  const [row] = await db
    .update(records)
    .set({ data: merged, updatedAt: new Date() })
    .where(and(eq(records.tenantId, tenantId), eq(records.id, id)))
    .returning();

  if (!row) throw new RecordError("That record no longer exists");

  for (const fieldId of changedFieldIds) {
    await db.insert(activityEntries).values({
      tenantId,
      recordId: id,
      kind: "field_change",
      actor,
      detail: { fieldId, from: existing.data[fieldId] ?? null, to: merged[fieldId] ?? null },
    });
  }

  return { record: toCrmRecord(row), changedFieldIds, previous: existing.data };
}

export async function deleteRecord(db: Db, tenantId: string, id: string): Promise<void> {
  await db
    .update(records)
    .set({ deletedAt: new Date() })
    .where(and(eq(records.tenantId, tenantId), eq(records.id, id)));
}

/**
 * Titles for a set of record ids, so a relation renders as "Acme Corp" rather
 * than a uuid. One query, not one per cell.
 */
export async function titlesFor(
  db: Db,
  tenantId: string,
  config: Config,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const rows = await db
    .select({ id: records.id, objectKey: records.objectKey, data: records.data })
    .from(records)
    .where(and(eq(records.tenantId, tenantId), inArray(records.id, unique)));

  const titleFieldByObject = new Map(
    config.objects.map((object) => [object.key, object.titleFieldId ?? object.fields[0]?.id]),
  );

  return new Map(
    rows.map((row) => {
      const titleFieldId = titleFieldByObject.get(row.objectKey as ObjectKey);
      const title = titleFieldId ? row.data[titleFieldId] : undefined;
      return [row.id, title ? String(title) : "Untitled"];
    }),
  );
}

export async function timelineFor(
  db: Db,
  tenantId: string,
  recordId: string,
  limit = 50,
): Promise<
  { id: string; kind: string; actor: string; detail: Record<string, unknown>; createdAt: string }[]
> {
  const rows = await db
    .select()
    .from(activityEntries)
    .where(and(eq(activityEntries.tenantId, tenantId), eq(activityEntries.recordId, recordId)))
    .orderBy(sql`${activityEntries.createdAt} desc`)
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    actor: row.actor,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  }));
}
