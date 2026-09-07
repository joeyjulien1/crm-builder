import { and, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { detectDelimiter, parseCsv } from "./csv";

/** Never send the whole file to the model. */
export const MAX_SAMPLE_ROWS = 20;

/**
 * Import mapping is the one place the agent sees customer data, and only
 * because the user handed the file over. It sees the headers and at most
 * twenty rows.
 */
export async function readImportSample(
  tenantId: string,
  fileId: string,
): Promise<{ headers: string[]; rows: string[][] }> {
  const [file] = await withTenant(tenantId, (db) =>
    db
      .select()
      .from(files)
      .where(and(eq(files.tenantId, tenantId), eq(files.id, fileId)))
      .limit(1),
  );

  if (!file) throw new Error("That file is no longer available.");

  const parsed = parseCsv(file.contents, detectDelimiter(file.contents));
  return { headers: parsed.headers, rows: parsed.rows.slice(0, MAX_SAMPLE_ROWS) };
}
