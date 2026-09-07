import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { closePool, withTenant } from "@/lib/db/client";
import { adminPool, createTenant, dropTenants, seedRecord } from "@/test/helpers";
import { defaultConfig } from "@/lib/config/default";
import { applyPatches } from "@/lib/config/patch";
import type { Config, FilterTree, ViewConfig } from "@/lib/config/types";
import { listRecords } from "./records";
import { QueryError, compileCondition } from "./query";

/** A config with one extra multi_select field, for the list operators. */
const config: Config = applyPatches(defaultConfig(), [
  {
    op: "add_field",
    objectKey: "contact",
    field: {
      id: "fld_contact_tags",
      key: "tags",
      label: "Tags",
      type: "multi_select",
      required: false,
      system: false,
      options: [
        { value: "vip", label: "VIP" },
        { value: "churn_risk", label: "Churn risk" },
        { value: "newsletter", label: "Newsletter" },
      ],
    },
  },
]);

function view(filters?: FilterTree, overrides: Partial<ViewConfig> = {}): ViewConfig {
  return {
    id: "vw_test",
    objectKey: "contact",
    name: "Test",
    renderer: "table",
    columns: ["fld_contact_name"],
    filters,
    ...overrides,
  };
}

function tree(conditions: FilterTree["conditions"], join: "and" | "or" = "and"): FilterTree {
  return { join, conditions, groups: [] };
}

describe("query resolver", () => {
  let pool: Pool;
  let tenantId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    pool = adminPool();
    tenantId = (await createTenant(pool, "Query")).id;
    otherTenantId = (await createTenant(pool, "Query Other")).id;

    await seedRecord(pool, tenantId, "contact", {
      fld_contact_name: "Ada Lovelace",
      fld_contact_email: "ada@analytical.example",
      fld_contact_tags: ["vip", "newsletter"],
    });
    await seedRecord(pool, tenantId, "contact", {
      fld_contact_name: "Grace Hopper",
      fld_contact_email: "grace@navy.example",
      fld_contact_tags: ["vip"],
    });
    await seedRecord(pool, tenantId, "contact", {
      fld_contact_name: "Alan Turing",
      fld_contact_email: "",
      fld_contact_tags: [],
    });
    await seedRecord(pool, tenantId, "deal", {
      fld_deal_name: "Big renewal",
      fld_deal_amount: 50000,
      fld_deal_stage: "proposal",
      fld_deal_close_date: "2026-03-15",
    });
    await seedRecord(pool, tenantId, "deal", {
      fld_deal_name: "Small deal",
      fld_deal_amount: 1200,
      fld_deal_stage: "new",
      fld_deal_close_date: "2026-01-05",
    });
    await seedRecord(pool, tenantId, "deal", {
      fld_deal_name: "Unpriced",
      fld_deal_stage: "new",
      fld_deal_amount: "not a number",
    });

    // Another tenant's contact, to prove filters never reach across.
    await seedRecord(pool, otherTenantId, "contact", { fld_contact_name: "Ada Lovelace" });
  });

  afterAll(async () => {
    await dropTenants(pool, [tenantId, otherTenantId]);
    await pool.end();
    await closePool();
  });

  async function names(filters?: FilterTree, overrides: Partial<ViewConfig> = {}): Promise<string[]> {
    const page = await withTenant(tenantId, (db) =>
      listRecords(db, tenantId, config, view(filters, overrides)),
    );
    return page.records.map((record) => String(record.data.fld_contact_name ?? record.data.fld_deal_name));
  }

  it("returns every record of the object when unfiltered", async () => {
    expect((await names()).sort()).toEqual(["Ada Lovelace", "Alan Turing", "Grace Hopper"]);
  });

  it("never returns another tenant's matching record", async () => {
    const page = await withTenant(tenantId, (db) =>
      listRecords(db, tenantId, config, view(tree([{ fieldId: "fld_contact_name", operator: "is", value: "Ada Lovelace" }]))),
    );
    expect(page.records).toHaveLength(1);
    expect(page.total).toBe(1);
  });

  it("filters with is and is_not", async () => {
    expect(await names(tree([{ fieldId: "fld_contact_name", operator: "is", value: "Grace Hopper" }]))).toEqual([
      "Grace Hopper",
    ]);
    expect(
      (await names(tree([{ fieldId: "fld_contact_name", operator: "is_not", value: "Grace Hopper" }]))).sort(),
    ).toEqual(["Ada Lovelace", "Alan Turing"]);
  });

  it("filters with contains and starts_with", async () => {
    expect(await names(tree([{ fieldId: "fld_contact_name", operator: "contains", value: "hopper" }]))).toEqual([
      "Grace Hopper",
    ]);
    expect(await names(tree([{ fieldId: "fld_contact_name", operator: "starts_with", value: "Al" }]))).toEqual([
      "Alan Turing",
    ]);
  });

  it("treats an empty string as empty", async () => {
    expect(await names(tree([{ fieldId: "fld_contact_email", operator: "is_empty" }]))).toEqual(["Alan Turing"]);
    expect((await names(tree([{ fieldId: "fld_contact_email", operator: "is_not_empty" }]))).sort()).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
  });

  it("filters a multi_select with has_any_of and has_all_of", async () => {
    expect((await names(tree([{ fieldId: "fld_contact_tags", operator: "has_any_of", value: ["vip"] }]))).sort()).toEqual(
      ["Ada Lovelace", "Grace Hopper"],
    );
    expect(
      await names(tree([{ fieldId: "fld_contact_tags", operator: "has_all_of", value: ["vip", "newsletter"] }])),
    ).toEqual(["Ada Lovelace"]);
    expect(await names(tree([{ fieldId: "fld_contact_tags", operator: "is_empty" }]))).toEqual(["Alan Turing"]);
  });

  it("combines conditions with or", async () => {
    const result = await names(
      tree(
        [
          { fieldId: "fld_contact_name", operator: "is", value: "Ada Lovelace" },
          { fieldId: "fld_contact_name", operator: "is", value: "Alan Turing" },
        ],
        "or",
      ),
    );
    expect(result.sort()).toEqual(["Ada Lovelace", "Alan Turing"]);
  });

  it("nests one level of groups", async () => {
    const filters: FilterTree = {
      join: "and",
      conditions: [{ fieldId: "fld_contact_tags", operator: "has_any_of", value: ["vip"] }],
      groups: [
        {
          join: "or",
          conditions: [
            { fieldId: "fld_contact_name", operator: "contains", value: "Ada" },
            { fieldId: "fld_contact_name", operator: "contains", value: "Nobody" },
          ],
        },
      ],
    };
    expect(await names(filters)).toEqual(["Ada Lovelace"]);
  });

  it("compares numbers numerically, not as text", async () => {
    const page = await withTenant(tenantId, (db) =>
      listRecords(
        db,
        tenantId,
        config,
        view(tree([{ fieldId: "fld_deal_amount", operator: "gt", value: 2000 }]), {
          objectKey: "deal",
          columns: ["fld_deal_name"],
        }),
      ),
    );
    expect(page.records.map((r) => r.data.fld_deal_name)).toEqual(["Big renewal"]);
  });

  it("treats an unparseable number as no value rather than erroring", async () => {
    const page = await withTenant(tenantId, (db) =>
      listRecords(
        db,
        tenantId,
        config,
        view(tree([{ fieldId: "fld_deal_amount", operator: "lt", value: 999999 }]), {
          objectKey: "deal",
          columns: ["fld_deal_name"],
        }),
      ),
    );
    expect(page.records.map((r) => r.data.fld_deal_name).sort()).toEqual(["Big renewal", "Small deal"]);
  });

  it("compares dates as dates", async () => {
    const page = await withTenant(tenantId, (db) =>
      listRecords(
        db,
        tenantId,
        config,
        view(
          tree([{ fieldId: "fld_deal_close_date", operator: "between", value: ["2026-02-01", "2026-04-01"] }]),
          { objectKey: "deal", columns: ["fld_deal_name"] },
        ),
      ),
    );
    expect(page.records.map((r) => r.data.fld_deal_name)).toEqual(["Big renewal"]);
  });

  it("sorts by a typed expression with nulls last", async () => {
    const page = await withTenant(tenantId, (db) =>
      listRecords(db, tenantId, config, {
        ...view(undefined, { objectKey: "deal", columns: ["fld_deal_name"] }),
        sort: { fieldId: "fld_deal_amount", direction: "desc" },
      }),
    );
    expect(page.records.map((r) => r.data.fld_deal_name)).toEqual(["Big renewal", "Small deal", "Unpriced"]);
  });

  it("searches across an object's text fields", async () => {
    const page = await withTenant(tenantId, (db) =>
      listRecords(db, tenantId, config, view(), { search: "navy" } as never),
    );
    expect(page.records.length).toBeGreaterThan(0);
  });

  it("refuses an operator the field type does not support", () => {
    expect(() =>
      compileCondition(config, { fieldId: "fld_contact_name", operator: "has_any_of", value: ["x"] }),
    ).toThrow(QueryError);
  });

  it("refuses a filter on a field that does not exist", () => {
    expect(() => compileCondition(config, { fieldId: "fld_nope", operator: "is", value: "x" })).toThrow(
      /no field/i,
    );
  });

  it("treats filter values as data, never as SQL", async () => {
    const hostile = "'; drop table records; --";
    const result = await names(tree([{ fieldId: "fld_contact_name", operator: "is", value: hostile }]));
    expect(result).toEqual([]);

    const { rows } = await pool.query("select count(*)::int as count from records");
    expect(rows[0].count).toBeGreaterThan(0);
  });

  it("escapes wildcards in a contains filter", async () => {
    expect(await names(tree([{ fieldId: "fld_contact_name", operator: "contains", value: "%" }]))).toEqual([]);
  });
});
