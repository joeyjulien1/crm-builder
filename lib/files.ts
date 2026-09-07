import { and, eq } from "drizzle-orm";
import { files } from "./db/schema";
import type { Db } from "./db/client";

/**
 * Uploaded images and data files, on top of the import files table.
 *
 * Two encodings share `contents`: data uploads stay raw text (the import
 * reader parses it as CSV), images are stored base64. The `kind` column says
 * which — always go through fileBytes() rather than branching inline.
 */

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export const DATA_MIME_TYPES = ["text/csv", "text/plain"] as const;

/** Raw bytes cap per upload. The composer downscales images well under this. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type UploadKind = "image" | "data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function classifyMime(mimeType: string): UploadKind | null {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) return "image";
  if ((DATA_MIME_TYPES as readonly string[]).includes(mimeType)) return "data";
  return null;
}

export interface ValidatedUpload {
  filename: string;
  mimeType: string;
  kind: UploadKind;
  /** Raw bytes, for the byte_size column. */
  byteSize: number;
  /** What lands in contents: raw text for data, base64 for images. */
  storage: string;
}

/**
 * Pure validation + normalization for an upload transport payload. The client
 * always sends base64; data uploads are decoded back to raw text so the
 * import reader keeps working byte-for-byte.
 */
export function validateUpload(input: {
  filename?: unknown;
  mimeType?: unknown;
  data?: unknown;
}): { ok: true; upload: ValidatedUpload } | { ok: false; error: string } {
  const filename = typeof input.filename === "string" ? input.filename.trim().slice(0, 180) : "";
  if (!filename) return { ok: false, error: "A filename is required." };
  if (filename.includes("/") || filename.includes("\\")) {
    return { ok: false, error: "That filename is not allowed." };
  }

  const mimeType = typeof input.mimeType === "string" ? input.mimeType.trim().toLowerCase() : "";
  const kind = classifyMime(mimeType);
  if (!kind) {
    return {
      ok: false,
      error: "That file type is not supported. Images (JPEG, PNG, WebP, GIF) or CSV/text files.",
    };
  }

  if (typeof input.data !== "string" || input.data.length === 0) {
    return { ok: false, error: "The file arrived empty." };
  }
  let raw: Buffer;
  try {
    raw = Buffer.from(input.data, "base64");
  } catch {
    return { ok: false, error: "The file could not be decoded." };
  }
  if (raw.length === 0 || raw.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That file is too large. Files must be under 8 MB." };
  }

  if (kind === "data") {
    const text = raw.toString("utf8");
    if (!text.trim()) return { ok: false, error: "The file arrived empty." };
    return { ok: true, upload: { filename, mimeType, kind, byteSize: raw.length, storage: text } };
  }
  return {
    ok: true,
    upload: { filename, mimeType, kind, byteSize: raw.length, storage: input.data },
  };
}

export interface SavedUpload {
  id: string;
  filename: string;
  mimeType: string;
  kind: string;
  byteSize: number;
}

/** Insert runs inside withTenant, so RLS stamps the write to the caller. */
export async function saveUpload(
  db: Db,
  tenantId: string,
  upload: ValidatedUpload,
): Promise<SavedUpload> {
  const [row] = await db
    .insert(files)
    .values({
      tenantId,
      filename: upload.filename,
      contents: upload.storage,
      mimeType: upload.mimeType,
      byteSize: upload.byteSize,
      kind: upload.kind,
    })
    .returning({
      id: files.id,
      filename: files.filename,
      mimeType: files.mimeType,
      kind: files.kind,
      byteSize: files.byteSize,
    });
  if (!row) throw new Error("The upload could not be saved.");
  return { ...row, mimeType: row.mimeType ?? "", kind: row.kind ?? "", byteSize: row.byteSize ?? 0 };
}

export interface StoredUpload {
  id: string;
  filename: string;
  mimeType: string;
  kind: string;
  byteSize: number;
  contents: string;
}

/** Read runs inside withTenant: another tenant's id resolves to nothing. */
export async function getUpload(db: Db, tenantId: string, id: string): Promise<StoredUpload | null> {
  if (!isUuid(id)) return null;
  const rows = await db
    .select({
      id: files.id,
      filename: files.filename,
      mimeType: files.mimeType,
      kind: files.kind,
      byteSize: files.byteSize,
      contents: files.contents,
    })
    .from(files)
    .where(and(eq(files.id, id), eq(files.tenantId, tenantId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    mimeType: row.mimeType ?? "",
    kind: row.kind ?? "",
    byteSize: row.byteSize ?? 0,
  };
}

/** Raw bytes for a stored upload: base64-decoded for images, utf8 for data. */
export function fileBytes(upload: StoredUpload): Buffer {
  if (upload.kind === "image") return Buffer.from(upload.contents, "base64");
  return Buffer.from(upload.contents, "utf8");
}

/** Base64 body for a vision request, whatever the stored encoding. */
export function fileBase64(upload: StoredUpload): string {
  if (upload.kind === "image") return upload.contents;
  return Buffer.from(upload.contents, "utf8").toString("base64");
}

export function uploadUrl(id: string): string {
  return `/api/files/${id}`;
}
