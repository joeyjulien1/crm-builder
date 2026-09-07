"use server";

import { and, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { files, importJobs } from "@/lib/db/schema";
import { getCurrentVersion } from "@/lib/config/version";
import type { ObjectKey } from "@/lib/config/types";
import { detectDelimiter, parseCsv } from "@/lib/import/csv";
import { proposeMapping } from "@/lib/import/mapping";
import { MAX_SAMPLE_ROWS } from "@/lib/import/sample";
import type { ImportJobPayload } from "@/lib/import/run";
import { enqueue, QUEUES } from "@/lib/jobs/queue";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface UploadResult {
  fileId: string;
  filename: string;
  headers: string[];
  sample: string[][];
  rowCount: number;
  mapping: Record<string, string>;
  unmapped: string[];
  dedupeKey?: string;
  fields: { id: string; label: string; type: string; required: boolean }[];
}

export async function uploadImportFileAction(
  objectKey: ObjectKey,
  formData: FormData,
): Promise<UploadResult | { error: string }> {
  const session = await requireSession();

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose a CSV file to import." };
  if (file.size > MAX_FILE_BYTES) return { error: "That file is larger than 10 MB. Split it and try again." };

  const contents = await file.text();
  const parsed = parseCsv(contents, detectDelimiter(contents));
  if (parsed.headers.length === 0) return { error: "That file has no header row." };
  if (parsed.rows.length === 0) return { error: "That file has headers but no rows." };

  return withTenant(session.tenantId, async (db) => {
    const { config } = await getCurrentVersion(db, session.tenantId);
    const object = config.objects.find((candidate) => candidate.key === objectKey);
    if (!object) return { error: `There is no ${objectKey} object.` };

    const [stored] = await db
      .insert(files)
      .values({ tenantId: session.tenantId, filename: file.name, contents })
      .returning();
    if (!stored) return { error: "That file could not be stored." };

    const proposal = proposeMapping(object, parsed.headers, parsed.rows);

    return {
      fileId: stored.id,
      filename: file.name,
      headers: parsed.headers,
      sample: parsed.rows.slice(0, MAX_SAMPLE_ROWS),
      rowCount: parsed.rows.length,
      mapping: proposal.mapping,
      unmapped: proposal.unmapped,
      dedupeKey: proposal.dedupeKey,
      fields: object.fields.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        required: field.required,
      })),
    };
  });
}

export async function startImportAction(input: {
  fileId: string;
  objectKey: ObjectKey;
  mapping: Record<string, string>;
  dedupeKey?: string;
}): Promise<{ importJobId: string } | { error: string }> {
  const session = await requireSession();

  if (Object.keys(input.mapping).length === 0) {
    return { error: "Map at least one column before importing." };
  }

  const job = await withTenant(session.tenantId, async (db) => {
    const [created] = await db
      .insert(importJobs)
      .values({
        tenantId: session.tenantId,
        fileId: input.fileId,
        objectKey: input.objectKey,
        mapping: input.mapping,
        dedupeKey: input.dedupeKey ?? null,
        status: "queued",
      })
      .returning();
    return created;
  });

  if (!job) return { error: "That import could not be queued." };

  // Background, not inline: a large spreadsheet must not run inside a request.
  await enqueue<ImportJobPayload>(QUEUES.import, {
    tenantId: session.tenantId,
    importJobId: job.id,
  });

  return { importJobId: job.id };
}

export interface ImportStatus {
  status: string;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  total: number;
  error?: string;
}

export async function importStatusAction(importJobId: string): Promise<ImportStatus | null> {
  const session = await requireSession();

  const [job] = await withTenant(session.tenantId, (db) =>
    db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.tenantId, session.tenantId), eq(importJobs.id, importJobId)))
      .limit(1),
  );

  if (!job) return null;
  return {
    status: job.status,
    processed: job.processed,
    created: job.created,
    updated: job.updated,
    skipped: job.skipped,
    total: job.total,
    error: job.error ?? undefined,
  };
}
