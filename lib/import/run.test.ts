import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import type { Pool } from "pg";
import { closePool, withTenant } from "@/lib/db/client";
import { files, importJobs, records } from "@/lib/db/schema";
import { adminPool, createTenant, dropTenants, seedModel } from "@/test/helpers";
import { defaultConfig } from "@/lib/config/default";
import { detectDelimiter, parseCsv } from "./csv";
import { proposeMapping } from "./mapping";
import { runImport } from "./run";

describe("csv parsing", () => {
  it("handles quotes, escaped quotes, commas and newlines inside fields", () => {
    const parsed = parseCsv(
      'Name,Notes\n"Hopper, Grace","She said ""compile it"" and\nmeant it"\nTuring,Plain\n',
    );
    expect(parsed.headers).toEqual(["Name", "Notes"]);
    expect(parsed.rows).toEqual([
      ["Hopper, Grace", 'She said "compile it" and\nmeant it'],
      ["Turing", "Plain"],
    ]);
  });

  it("does not invent a trailing empty row", () => {
    expect(parseCsv("A,B\n1,2\n").rows).toHaveLength(1);
  });

  it("picks the delimiter the file actually uses", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
  });
});

describe("mapping proposal", () => {
  const contact = defaultConfig().objects.find((object) => object.key === "contact")!;

  it("matches headers people actually export", () => {
    const { mapping } = proposeMapping(
      contact,
      ["Full Name", "Email Address", "Telephone", "Job title"],
      [["Ada Lovelace", "ada@example.com", "+1 555 0100", "Analyst"]],
    );

    expect(mapping["Full Name"]).toBe("fld_contact_name");
    expect(mapping["Email Address"]).toBe("fld_contact_email");
    expect(mapping["Telephone"]).toBe("fld_contact_phone");
    expect(mapping["Job title"]).toBe("fld_contact_title");
  });

  it("falls back to the shape of the values when the header is unhelpful", () => {
    const { mapping } = proposeMapping(
      contact,
      ["Column 3"],
      [["ada@example.com"], ["grace@example.com"]],
    );
    expect(mapping["Column 3"]).toBe("fld_contact_email");
  });

  it("leaves a column it cannot place unmapped rather than guessing", () => {
    const { mapping, unmapped } = proposeMapping(contact, ["Zorble"], [["17"], ["42"]]);
    expect(mapping["Zorble"]).toBeUndefined();
    expect(unmapped).toContain("Zorble");
  });

  it("proposes deduping on email", () => {
    const { dedupeKey } = proposeMapping(
      contact,
      ["Name", "Email"],
      [["Ada", "ada@example.com"]],
    );
    expect(dedupeKey).toBe("fld_contact_email");
  });
});

describe("running an import", () => {
  let pool: Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = adminPool();
    tenantId = (await createTenant(pool, "Import")).id;
    // A workspace starts with no objects; an import needs somewhere to land.
    await seedModel(pool, tenantId);
  });

  afterAll(async () => {
    await dropTenants(pool, [tenantId]);
    await pool.end();
    await closePool();
  });

  async function queue(contents: string, dedupeKey?: string): Promise<string> {
    return withTenant(tenantId, async (db) => {
      const [file] = await db
        .insert(files)
        .values({ tenantId, filename: "contacts.csv", contents })
        .returning();

      const [job] = await db
        .insert(importJobs)
        .values({
          tenantId,
          fileId: file!.id,
          objectKey: "contact",
          mapping: {
            Name: "fld_contact_name",
            Email: "fld_contact_email",
            Phone: "fld_contact_phone",
          },
          dedupeKey: dedupeKey ?? null,
        })
        .returning();

      return job!.id;
    });
  }

  it("creates a record per row and reports what it did", async () => {
    const jobId = await queue(
      "Name,Email,Phone\nAda Lovelace,ada@example.com,+1 555 0100\nGrace Hopper,grace@example.com,+1 555 0101\n",
    );

    const progress = await runImport({ tenantId, importJobId: jobId });
    expect(progress).toMatchObject({ created: 2, updated: 0, skipped: 0, total: 2 });

    const rows = await withTenant(tenantId, (db) =>
      db
        .select()
        .from(records)
        .where(and(eq(records.tenantId, tenantId), eq(records.objectKey, "contact"), isNull(records.deletedAt))),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.data.fld_contact_name).sort()).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("updates rather than duplicating when a dedupe key is given", async () => {
    const jobId = await queue(
      "Name,Email,Phone\nAda Lovelace,ada@example.com,+44 20 7946 0000\n",
      "fld_contact_email",
    );

    const progress = await runImport({ tenantId, importJobId: jobId });
    expect(progress).toMatchObject({ created: 0, updated: 1 });

    const rows = await withTenant(tenantId, (db) =>
      db
        .select()
        .from(records)
        .where(and(eq(records.tenantId, tenantId), eq(records.objectKey, "contact"), isNull(records.deletedAt))),
    );
    expect(rows).toHaveLength(2);
    const ada = rows.find((row) => row.data.fld_contact_email === "ada@example.com");
    expect(ada?.data.fld_contact_phone).toBe("+44 20 7946 0000");
  });

  it("skips a row that cannot satisfy a required field instead of failing the import", async () => {
    const jobId = await queue("Name,Email,Phone\n,nobody@example.com,\nReal Person,real@example.com,\n");

    const progress = await runImport({ tenantId, importJobId: jobId });
    expect(progress.skipped).toBe(1);
    expect(progress.created).toBe(1);
  });

  it("records its final state on the job row", async () => {
    const jobId = await queue("Name,Email,Phone\nFinal Row,final@example.com,\n");
    await runImport({ tenantId, importJobId: jobId });

    const [job] = await withTenant(tenantId, (db) =>
      db
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, jobId)))
        .limit(1),
    );
    expect(job?.status).toBe("done");
    expect(job?.processed).toBe(1);
  });
});
