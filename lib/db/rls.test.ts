import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { adminPool, createTenant, dropTenants, seedRecord } from "@/test/helpers";
import { closePool, withoutTenant, withTenant } from "./client";
import { files, projects, records, TENANT_SCOPED_TABLES } from "./schema";
import { fileBytes, getUpload, saveUpload, validateUpload } from "@/lib/files";
import { getProject, listProjects, saveProject } from "@/lib/projects";
import { defaultConfig } from "@/lib/config/default";

/**
 * Tenant isolation is enforced in the database. These tests read through the
 * application pool with no `where tenant_id = ?` at all — if a row from another
 * tenant comes back, the policy is not doing its job.
 */
describe("tenant isolation", () => {
  let pool: Pool;
  let tenantA: string;
  let tenantB: string;
  let recordA: string;
  let recordB: string;

  beforeAll(async () => {
    pool = adminPool();
    tenantA = (await createTenant(pool, "Tenant A")).id;
    tenantB = (await createTenant(pool, "Tenant B")).id;
    recordA = await seedRecord(pool, tenantA, "contact", { name: "Ada from A" });
    recordB = await seedRecord(pool, tenantB, "contact", { name: "Bo from B" });
  });

  afterAll(async () => {
    await dropTenants(pool, [tenantA, tenantB]);
    await pool.end();
    await closePool();
  });

  it("hides another tenant's rows from an unfiltered query", async () => {
    const rows = await withTenant(tenantA, async (db) => db.select().from(records));

    expect(rows.map((r) => r.id)).toContain(recordA);
    expect(rows.map((r) => r.id)).not.toContain(recordB);
    expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
  });

  it("hides a row even when asked for it by primary key", async () => {
    const rows = await withTenant(tenantA, async (db) =>
      db.select().from(records).where(sql`${records.id} = ${recordB}`),
    );

    expect(rows).toHaveLength(0);
  });

  it("refuses to update another tenant's row", async () => {
    const updated = await withTenant(tenantA, async (db) =>
      db
        .update(records)
        .set({ data: { name: "overwritten" } })
        .where(sql`${records.id} = ${recordB}`)
        .returning(),
    );

    expect(updated).toHaveLength(0);

    const { rows } = await pool.query<{ data: { name: string } }>(
      "select data from records where id = $1",
      [recordB],
    );
    expect(rows[0]?.data.name).toBe("Bo from B");
  });

  it("refuses to delete another tenant's row", async () => {
    const deleted = await withTenant(tenantA, async (db) =>
      db.delete(records).where(sql`${records.id} = ${recordB}`).returning(),
    );

    expect(deleted).toHaveLength(0);
  });

  it("refuses to write a row stamped with another tenant's id", async () => {
    await expect(
      withTenant(tenantA, async (db) =>
        db.insert(records).values({ tenantId: tenantB, objectKey: "contact", data: {} }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("fails closed when no tenant is set", async () => {
    const rows = await withoutTenant(async (db) => db.select().from(records));
    expect(rows).toHaveLength(0);
  });

  it("does not leak the tenant setting between pooled transactions", async () => {
    // Interleave enough times that a pooled connection is certainly reused.
    for (let i = 0; i < 8; i++) {
      const fromA = await withTenant(tenantA, async (db) => db.select().from(records));
      expect(fromA.every((r) => r.tenantId === tenantA)).toBe(true);

      const fromB = await withTenant(tenantB, async (db) => db.select().from(records));
      expect(fromB.every((r) => r.tenantId === tenantB)).toBe(true);
    }

    // After a scoped transaction the setting is gone, not carried forward.
    const leaked = await withoutTenant(async (db) =>
      db.execute(sql`select current_setting('app.tenant_id', true) as tenant`),
    );
    expect(leaked.rows[0]?.tenant ?? null).toBeFalsy();
  });

  it("rejects a tenant id that is not a uuid", async () => {
    await expect(
      withTenant("'; drop table records; --", async (db) => db.select().from(records)),
    ).rejects.toThrow(/uuid/i);
  });

  /**
   * The isolation tests above must be testing the policy, not an accident of
   * the query builder. Turning the policy off has to make them fail.
   */
  it("leaks once the policy is removed, which is what the tests above catch", async () => {
    await pool.query("alter table records disable row level security");
    try {
      const rows = await withTenant(tenantA, async (db) => db.select().from(records));
      expect(rows.map((r) => r.id)).toContain(recordB);
    } finally {
      await pool.query("alter table records enable row level security");
    }

    const rows = await withTenant(tenantA, async (db) => db.select().from(records));
    expect(rows.map((r) => r.id)).not.toContain(recordB);
  });
});

/**
 * A tenant-scoped table without a policy should fail CI, not ship. This
 * compares what the schema declares against what Postgres actually enforces.
 */
describe("policy coverage", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = adminPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("has row-level security enabled and forced on every tenant-scoped table", async () => {
    const { rows } = await pool.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity
       from pg_class
       where relname = any($1) and relkind = 'r'`,
      [[...TENANT_SCOPED_TABLES]],
    );

    expect(rows).toHaveLength(TENANT_SCOPED_TABLES.length);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} has RLS disabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} does not force RLS on its owner`).toBe(true);
    }
  });

  it("has an isolation policy on every tenant-scoped table", async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_policies where schemaname = 'public' and policyname = 'tenant_isolation'",
    );
    const withPolicy = new Set(rows.map((r) => r.tablename));

    for (const table of TENANT_SCOPED_TABLES) {
      expect(withPolicy.has(table), `${table} has no tenant_isolation policy`).toBe(true);
    }
  });

  it("knows about every table that carries a tenant_id", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.columns
       where table_schema = 'public' and column_name = 'tenant_id'
       order by table_name`,
    );
    const inDatabase = rows.map((r) => r.table_name).filter((name) => name !== "sessions");

    // sessions carries a nullable tenant_id for the active workspace only; it
    // is keyed by an unguessable token and is not tenant-scoped data.
    expect(inDatabase).toEqual([...TENANT_SCOPED_TABLES]);
  });
});

/**
 * Uploads share the files table and its policy, new columns included: a
 * tenant reads back its own bytes and nothing of anyone else's.
 */
describe("file isolation", () => {
  let pool: Pool;
  let tenantA: string;
  let tenantB: string;

  const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const imageUpload = () => {
    const validated = validateUpload({
      filename: "logo.png",
      mimeType: "image/png",
      data: imageBytes.toString("base64"),
    });
    if (!validated.ok) throw new Error("fixture upload rejected");
    return validated.upload;
  };

  beforeAll(async () => {
    pool = adminPool();
    tenantA = (await createTenant(pool, "Files A")).id;
    tenantB = (await createTenant(pool, "Files B")).id;
  });

  afterAll(async () => {
    await dropTenants(pool, [tenantA, tenantB]);
    await pool.end();
    await closePool();
  });

  it("reads back its own upload byte-for-byte", async () => {
    const saved = await withTenant(tenantA, (db) => saveUpload(db, tenantA, imageUpload()));
    const loaded = await withTenant(tenantA, (db) => getUpload(db, tenantA, saved.id));

    expect(loaded?.filename).toBe("logo.png");
    expect(loaded && fileBytes(loaded).equals(imageBytes)).toBe(true);
  });

  it("hides another tenant's upload", async () => {
    const saved = await withTenant(tenantA, (db) => saveUpload(db, tenantA, imageUpload()));
    const loaded = await withTenant(tenantB, (db) => getUpload(db, tenantB, saved.id));

    expect(loaded).toBeNull();
  });

  it("refuses to write a file stamped with another tenant's id", async () => {
    await expect(
      withTenant(tenantA, async (db) =>
        db.insert(files).values({
          tenantId: tenantB,
          filename: "logo.png",
          contents: imageBytes.toString("base64"),
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

/**
 * Saved generations isolate like everything else: a tenant lists and opens
 * only its own projects.
 */
describe("project isolation", () => {
  let pool: Pool;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    pool = adminPool();
    tenantA = (await createTenant(pool, "Projects A")).id;
    tenantB = (await createTenant(pool, "Projects B")).id;
  });

  afterAll(async () => {
    await dropTenants(pool, [tenantA, tenantB]);
    await pool.end();
    await closePool();
  });

  it("lists only its own projects, without their configs", async () => {
    await withTenant(tenantA, (db) =>
      saveProject(db, tenantA, { name: "Pipeline OS", prompt: "Build it", config: defaultConfig() }),
    );
    await withTenant(tenantB, (db) =>
      saveProject(db, tenantB, { name: "Other CRM", prompt: "Build that", config: defaultConfig() }),
    );

    const listed = await withTenant(tenantA, (db) => listProjects(db, tenantA));

    expect(listed.map((p) => p.name)).toContain("Pipeline OS");
    expect(listed.map((p) => p.name)).not.toContain("Other CRM");
    expect(listed.every((p) => !("config" in p))).toBe(true);
  });

  it("hides another tenant's project detail", async () => {
    const saved = await withTenant(tenantA, (db) =>
      saveProject(db, tenantA, { name: "Pipeline OS", prompt: "Build it", config: defaultConfig() }),
    );
    const loaded = await withTenant(tenantB, (db) => getProject(db, tenantB, saved.id));

    expect(loaded).toBeNull();
  });

  it("refuses to write a project stamped with another tenant's id", async () => {
    await expect(
      withTenant(tenantA, (db) =>
        db.insert(projects).values({
          tenantId: tenantB,
          name: "Pipeline OS",
          prompt: "Build it",
          config: defaultConfig(),
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
