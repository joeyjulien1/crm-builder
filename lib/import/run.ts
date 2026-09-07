import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { files, importJobs, records } from "@/lib/db/schema";
import { getCurrentVersion } from "@/lib/config/version";
import { coerceValue, validateValue } from "@/lib/runtime/field";
import { createRecord, updateRecord } from "@/lib/runtime/records";
import { dispatchRecordEvent } from "@/lib/automations/dispatch";
import type { Config, ObjectKey } from "@/lib/config/types";
import { detectDelimiter, parseCsv } from "./csv";

export interface ImportJobPayload {
  tenantId: string;
  importJobId: string;
}

export interface ImportProgress {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  total: number;
}

/**
 * Runs in the background, never inline: a spreadsheet with 20,000 rows is not
 * something to do inside a request. Progress is written as it goes so the
 * onboarding screen can show it moving.
 */
export async function runImport(payload: ImportJobPayload): Promise<ImportProgress> {
  const { tenantId, importJobId } = payload;

  const { job, file, config } = await withTenant(tenantId, async (db) => {
    const [found] = await db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, importJobId)))
      .limit(1);
    if (!found) throw new Error("That import is no longer queued.");

    const [source] = await db
      .select()
      .from(files)
      .where(and(eq(files.tenantId, tenantId), eq(files.id, found.fileId)))
      .limit(1);
    if (!source) throw new Error("The uploaded file is no longer available.");

    return { job: found, file: source, config: (await getCurrentVersion(db, tenantId)).config };
  });

  const parsed = parseCsv(file.contents, detectDelimiter(file.contents));
  const mapping = job.mapping as Record<string, string>;
  const objectKey = job.objectKey as ObjectKey;
  const object = config.objects.find((candidate) => candidate.key === objectKey);
  if (!object) throw new Error(`There is no ${objectKey} object to import into.`);

  const fieldsById = new Map(object.fields.map((field) => [field.id, field]));
  const columnIndex = new Map(parsed.headers.map((header, index) => [header, index]));

  const progress: ImportProgress = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    total: parsed.rows.length,
  };

  await setStatus(tenantId, importJobId, "running", progress);

  for (const row of parsed.rows) {
    const values: Record<string, unknown> = {};

    for (const [header, fieldId] of Object.entries(mapping)) {
      const index = columnIndex.get(header);
      const field = fieldsById.get(fieldId);
      if (index === undefined || !field) continue;
      const coerced = coerceValue(field, row[index] ?? "");
      if (coerced !== null) values[fieldId] = coerced;
    }

    progress.processed++;

    // A row that cannot satisfy the object's required fields is skipped rather
    // than failing the whole import.
    const missingRequired = object.fields.some(
      (field) => field.required && validateValue(field, values[field.id]) !== null,
    );
    if (missingRequired || Object.keys(values).length === 0) {
      progress.skipped++;
      continue;
    }

    try {
      const existingId = job.dedupeKey ? await findExisting(tenantId, objectKey, job.dedupeKey, values[job.dedupeKey]) : null;

      if (existingId) {
        await withTenant(tenantId, (db) =>
          updateRecord(db, tenantId, config, existingId, values, "import"),
        );
        progress.updated++;
      } else {
        const created = await withTenant(tenantId, (db) =>
          createRecord(db, tenantId, config, objectKey, values, "import"),
        );
        progress.created++;
        await dispatchRecordEvent({
          tenantId,
          recordId: created.id,
          kind: "record_created",
          changedFieldIds: Object.keys(values),
          configVersion: 0,
        });
      }
    } catch {
      progress.skipped++;
    }

    if (progress.processed % 50 === 0) {
      await setStatus(tenantId, importJobId, "running", progress);
    }
  }

  await setStatus(tenantId, importJobId, "done", progress);
  return progress;
}

async function findExisting(
  tenantId: string,
  objectKey: ObjectKey,
  fieldId: string,
  value: unknown,
): Promise<string | null> {
  if (value === undefined || value === null || value === "") return null;

  const [row] = await withTenant(tenantId, (db) =>
    db
      .select({ id: records.id })
      .from(records)
      .where(
        and(
          eq(records.tenantId, tenantId),
          eq(records.objectKey, objectKey),
          isNull(records.deletedAt),
          sql`lower(${records.data} ->> ${fieldId}) = lower(${String(value)})`,
        ),
      )
      .limit(1),
  );

  return row?.id ?? null;
}

async function setStatus(
  tenantId: string,
  importJobId: string,
  status: string,
  progress: ImportProgress,
): Promise<void> {
  await withTenant(tenantId, (db) =>
    db
      .update(importJobs)
      .set({ status, ...progress })
      .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, importJobId))),
  );
}

export async function failImport(
  tenantId: string,
  importJobId: string,
  message: string,
): Promise<void> {
  await withTenant(tenantId, (db) =>
    db
      .update(importJobs)
      .set({ status: "failed", error: message })
      .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, importJobId))),
  );
}

export type { Config };
