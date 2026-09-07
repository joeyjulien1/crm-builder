import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { closePool, withTenant } from "@/lib/db/client";
import { adminPool, createTenant, dropTenants, seedModel, seedRecord } from "@/test/helpers";
import { defaultConfig, startingConfig } from "./default";
import { findField } from "./patch";
import { commitPatches, getCurrentVersion, getHistory, rollbackTo } from "./version";

describe("config versioning", () => {
  let pool: Pool;
  let tenantId: string;

  /** Untouched, so the "what does a new workspace start as" test can read it. */
  let freshTenantId: string;

  beforeAll(async () => {
    pool = adminPool();
    tenantId = (await createTenant(pool, "Versioning")).id;
    freshTenantId = (await createTenant(pool, "Versioning fresh")).id;
    // The tests below edit deals and pipelines, so this workspace has a model.
    // A real one would not: see startingConfig.
    await seedModel(pool, tenantId);
  });

  afterAll(async () => {
    await dropTenants(pool, [tenantId, freshTenantId]);
    await pool.end();
    await closePool();
  });

  it("opens a new workspace on nothing at all", async () => {
    const version = await withTenant(freshTenantId, (db) => getCurrentVersion(db, freshTenantId));
    expect(version.version).toBe(1);
    // No objects, no views, no pipeline. The starter sales CRM used to be
    // seeded here, and every workspace looked like it as a result.
    expect(version.config).toEqual(startingConfig());
    expect(version.config.objects).toHaveLength(0);
  });

  it("writes each change as a new immutable version", async () => {
    const committed = await withTenant(tenantId, (db) =>
      commitPatches(
        db,
        tenantId,
        [
          {
            op: "add_field",
            objectKey: "deal",
            field: {
              id: "fld_renewal",
              key: "renewal_date",
              label: "Renewal date",
              type: "date",
              required: false,
              system: false,
            },
          },
        ],
        "agent",
        "Added a renewal date to deals",
      ),
    );

    expect(committed.version).toBe(2);
    expect(findField(committed.config, "fld_renewal")).toBeDefined();

    // Version 1 is untouched.
    const history = await withTenant(tenantId, (db) => getHistory(db, tenantId));
    const first = history.find((v) => v.version === 1)!;
    expect(findField(first.config, "fld_renewal")).toBeUndefined();
  });

  it("rolls back by writing the old config forward as a new version", async () => {
    const rolled = await withTenant(tenantId, (db) => rollbackTo(db, tenantId, 1, "user"));

    expect(rolled.version).toBe(3);
    expect(rolled.config).toEqual(defaultConfig());
    expect(rolled.summary).toBe("Rolled back to version 1");
    expect(rolled.patch[0]?.op).toBe("rollback");

    const current = await withTenant(tenantId, (db) => getCurrentVersion(db, tenantId));
    expect(current.version).toBe(3);
    expect(findField(current.config, "fld_renewal")).toBeUndefined();
  });

  it("can roll forward again to any version it has", async () => {
    const rolled = await withTenant(tenantId, (db) => rollbackTo(db, tenantId, 2, "user"));
    expect(rolled.version).toBe(4);
    expect(findField(rolled.config, "fld_renewal")).toBeDefined();
  });

  it("refuses to mutate a version row", async () => {
    await expect(
      pool.query("update config_versions set summary = 'rewritten' where tenant_id = $1", [tenantId]),
    ).rejects.toThrow(/append-only/i);
  });

  it("moves records off a stage the patch removes", async () => {
    const dealId = await seedRecord(pool, tenantId, "deal", {
      fld_deal_name: "Acme renewal",
      fld_deal_stage: "negotiation",
    });


    await withTenant(tenantId, (db) =>
      commitPatches(
        db,
        tenantId,
        [
          {
            op: "update_pipeline",
            pipelineId: "pl_sales",
            stages: [
              { key: "new", label: "New" },
              { key: "proposal", label: "Proposal" },
              { key: "won", label: "Won", isWon: true },
              { key: "lost", label: "Lost", isLost: true },
            ],
            stageMigrations: [
              { from: "qualified", to: "new" },
              { from: "negotiation", to: "proposal" },
            ],
          },
        ],
        "agent",
        "Simplified the sales pipeline",
      ),
    );

    const { rows } = await pool.query<{ data: Record<string, string> }>(
      "select data from records where id = $1",
      [dealId],
    );
    expect(rows[0]?.data.fld_deal_stage).toBe("proposal");
  });

  it("refuses to roll back to a version that does not exist", async () => {
    await expect(withTenant(tenantId, (db) => rollbackTo(db, tenantId, 99, "user"))).rejects.toThrow(
      /no version 99/i,
    );
  });
});
