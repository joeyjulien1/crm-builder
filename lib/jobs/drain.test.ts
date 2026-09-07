import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { closePool, withTenant } from "@/lib/db/client";
import { files, importJobs, records } from "@/lib/db/schema";
import { adminPool, createTenant, dropTenants, seedModel } from "@/test/helpers";
import type { ImportJobPayload } from "@/lib/import/run";
import { drainQueues } from "./drain";
import { enqueue, QUEUES, stopBoss } from "./queue";

/**
 * The worker process and this drain run the same handlers. These tests cover
 * the serverless path, where nothing is sitting there consuming and the queue
 * only moves when a request asks it to.
 */
describe("draining the queue by request", () => {
  let pool: Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = adminPool();
    tenantId = (await createTenant(pool, "Drain")).id;
    await seedModel(pool, tenantId);
  });

  afterAll(async () => {
    await dropTenants(pool, [tenantId]);
    await stopBoss();
    await pool.end();
    await closePool();
  });

  it("runs a queued import that no worker is watching", async () => {
    const importJobId = await withTenant(tenantId, async (db) => {
      const [file] = await db
        .insert(files)
        .values({
          tenantId,
          filename: "drain.csv",
          contents: "Name,Email\nQueued Person,queued@example.com\n",
        })
        .returning();

      const [job] = await db
        .insert(importJobs)
        .values({
          tenantId,
          fileId: file!.id,
          objectKey: "contact",
          mapping: { Name: "fld_contact_name", Email: "fld_contact_email" },
        })
        .returning();

      return job!.id;
    });

    await enqueue<ImportJobPayload>(QUEUES.import, { tenantId, importJobId });

    // Nothing is consuming, so the job sits there until this call.
    const before = await withTenant(tenantId, (db) =>
      db
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, importJobId)))
        .limit(1),
    );
    expect(before[0]?.status).toBe("queued");

    const result = await drainQueues(20_000);
    expect(result.processed).toBeGreaterThan(0);
    expect(result.failed).toBe(0);

    const after = await withTenant(tenantId, (db) =>
      db
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, importJobId)))
        .limit(1),
    );
    expect(after[0]?.status).toBe("done");
    expect(after[0]?.created).toBe(1);

    const rows = await withTenant(tenantId, (db) =>
      db.select().from(records).where(and(eq(records.tenantId, tenantId), eq(records.objectKey, "contact"))),
    );
    expect(rows.map((row) => row.data.fld_contact_name)).toContain("Queued Person");
  });

  it("is a no-op when there is nothing queued", async () => {
    const result = await drainQueues(5_000);
    expect(result.failed).toBe(0);
  });
});
