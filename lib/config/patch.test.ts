import { describe, expect, it } from "vitest";
import { defaultConfig } from "./default";
import { applyPatch, applyPatches, findField, findObject, PatchError, validateConfig } from "./patch";
import { flattenSteps } from "./schema";
import type { Config, ConfigPatch } from "./types";

const base = defaultConfig();

function apply(patches: ConfigPatch[], config: Config = base): Config {
  return applyPatches(config, patches);
}

describe("applyPatch", () => {
  it("does not mutate the config it is given", () => {
    const before = structuredClone(base);
    apply([
      {
        op: "add_field",
        objectKey: "deal",
        field: { id: "fld_x", key: "renewal", label: "Renewal date", type: "date", required: false, system: false },
      },
    ]);
    expect(base).toEqual(before);
  });

  it("adds a field to an object", () => {
    const next = apply([
      {
        op: "add_field",
        objectKey: "deal",
        field: { id: "fld_renewal", key: "renewal_date", label: "Renewal date", type: "date", required: false, system: false },
      },
    ]);
    expect(findField(next, "fld_renewal")?.field.label).toBe("Renewal date");
    expect(findObject(next, "deal")!.fields).toHaveLength(findObject(base, "deal")!.fields.length + 1);
  });

  it("refuses a second field with the same key on one object", () => {
    expect(() =>
      apply([
        {
          op: "add_field",
          objectKey: "deal",
          field: { id: "fld_dupe", key: "amount", label: "Amount again", type: "currency", required: false, system: false },
        },
      ]),
    ).toThrow(PatchError);
  });

  it("refuses to remove a system field", () => {
    expect(() => apply([{ op: "remove_field", fieldId: "fld_deal_stage" }])).toThrow(/built-in/i);
  });

  it("removes a field and every reference to it", () => {
    const withField = apply([
      {
        op: "add_field",
        objectKey: "contact",
        field: { id: "fld_source", key: "source", label: "Source", type: "text", required: false, system: false },
      },
      { op: "update_view", viewId: "vw_contacts", columns: ["fld_contact_name", "fld_source"], sort: { fieldId: "fld_source", direction: "asc" } },
    ]);
    expect(withField.views.find((v) => v.id === "vw_contacts")!.columns).toContain("fld_source");

    const next = applyPatches(withField, [{ op: "remove_field", fieldId: "fld_source" }]);
    const view = next.views.find((v) => v.id === "vw_contacts")!;
    expect(findField(next, "fld_source")).toBeUndefined();
    expect(view.columns).not.toContain("fld_source");
    expect(view.sort).toBeUndefined();
  });

  it("refuses to remove a field an automation depends on", () => {
    const withAutomation = apply([
      {
        op: "add_field",
        objectKey: "contact",
        field: { id: "fld_score", key: "score", label: "Score", type: "number", required: false, system: false },
      },
      {
        op: "create_automation",
        automation: {
          id: "au_1",
          name: "Flag hot leads",
          enabled: true,
          trigger: { type: "field_changed", objectKey: "contact", fieldId: "fld_score" },
          steps: [{ id: "stp_1", type: "create_task", title: "Call this lead", dueInDays: 1 }],
        },
      },
    ]);

    expect(() => applyPatches(withAutomation, [{ op: "remove_field", fieldId: "fld_score" }])).toThrow(
      /Flag hot leads/,
    );
  });

  it("refuses to remove the field that holds a pipeline's stages", () => {
    expect(() => apply([{ op: "remove_field", fieldId: "fld_deal_stage" }])).toThrow();
  });

  it("has no way to change a field's type", () => {
    // Changing type is a data migration, not a config edit, so the patch shape
    // has nowhere to put it.
    const patch = { op: "update_field", fieldId: "fld_deal_amount", type: "text" };
    const next = apply([patch as unknown as ConfigPatch]);
    expect(findField(next, "fld_deal_amount")!.field.type).toBe("currency");
  });

  it("reorders fields only as a permutation", () => {
    const deal = findObject(base, "deal")!;
    const reversed = [...deal.fields.map((f) => f.id)].reverse();
    const next = apply([{ op: "reorder_fields", objectKey: "deal", fieldIds: reversed }]);
    expect(findObject(next, "deal")!.fields.map((f) => f.id)).toEqual(reversed);

    expect(() =>
      apply([{ op: "reorder_fields", objectKey: "deal", fieldIds: ["fld_deal_name"] }]),
    ).toThrow(/every field/i);
  });

  it("keeps a pipeline's stages and its stage field's options in step", () => {
    const next = apply([
      {
        op: "update_pipeline",
        pipelineId: "pl_sales",
        stages: [
          { key: "new", label: "New" },
          { key: "won", label: "Won", isWon: true },
        ],
        stageMigrations: [
          { from: "qualified", to: "new" },
          { from: "proposal", to: "new" },
          { from: "negotiation", to: "new" },
          { from: "lost", to: "won" },
        ],
      },
    ]);

    const stageField = findField(next, "fld_deal_stage")!.field;
    expect(stageField.options?.map((o) => o.value)).toEqual(["new", "won"]);
  });

  it("will not drop a pipeline stage without somewhere for its records to go", () => {
    expect(() =>
      apply([
        {
          op: "update_pipeline",
          pipelineId: "pl_sales",
          stages: [{ key: "new", label: "New" }],
        },
      ]),
    ).toThrow(/somewhere for its records to go/i);
  });

  it("will not send a stage's records to a stage that is being removed too", () => {
    expect(() =>
      apply([
        {
          op: "update_pipeline",
          pipelineId: "pl_sales",
          stages: [{ key: "new", label: "New" }],
          stageMigrations: [
            { from: "qualified", to: "proposal" },
            { from: "proposal", to: "new" },
            { from: "negotiation", to: "new" },
            { from: "won", to: "new" },
            { from: "lost", to: "new" },
          ],
        },
      ]),
    ).toThrow(/not a stage in this pipeline/i);
  });

  it("rejects a kanban view with no pipeline", () => {
    expect(() =>
      apply([
        {
          op: "create_view",
          view: { id: "vw_bad", objectKey: "deal", name: "Board", renderer: "kanban", columns: [] },
        },
      ]),
    ).toThrow(/needs a pipeline/i);
  });

  it("rejects a view whose columns belong to another object", () => {
    expect(() =>
      apply([
        {
          op: "create_view",
          view: {
            id: "vw_bad2",
            objectKey: "deal",
            name: "Mixed up",
            renderer: "table",
            columns: ["fld_contact_email"],
          },
        },
      ]),
    ).toThrow(/not on deal/i);
  });

  it("rejects a renderer that is not one of the three", () => {
    expect(() =>
      apply([
        {
          op: "create_view",
          view: {
            id: "vw_bad3",
            objectKey: "deal",
            name: "Calendar",
            renderer: "calendar" as never,
            columns: [],
          },
        },
      ]),
    ).toThrow();
  });

  it("restores a whole config on rollback", () => {
    const changed = apply([
      {
        op: "add_field",
        objectKey: "deal",
        field: { id: "fld_tmp", key: "tmp", label: "Temp", type: "text", required: false, system: false },
      },
    ]);
    const restored = applyPatch(changed, { op: "rollback", toVersion: 1, config: base });
    expect(restored).toEqual(base);
  });
});

describe("config validation", () => {
  it("accepts the default config", () => {
    expect(() => validateConfig(defaultConfig())).not.toThrow();
  });

  it("rejects two fields sharing an id", () => {
    const broken = structuredClone(base);
    broken.objects[0]!.fields[1]!.id = broken.objects[0]!.fields[0]!.id;
    expect(() => validateConfig(broken)).toThrow(/duplicate field id/i);
  });

  it("rejects a select field with no options", () => {
    const broken = structuredClone(base);
    const deal = broken.objects.find((o) => o.key === "deal")!;
    deal.fields.find((f) => f.id === "fld_deal_stage")!.options = [];
    expect(() => validateConfig(broken)).toThrow(/at least one option/i);
  });

  it("rejects a pipeline pointing at a field on another object", () => {
    const broken = structuredClone(base);
    broken.pipelines[0]!.stageFieldId = "fld_contact_email";
    expect(() => validateConfig(broken)).toThrow(/not on deal/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Round trips — every operation must reverse cleanly                          */
/* -------------------------------------------------------------------------- */

/** Small deterministic PRNG so a failure is reproducible from the seed. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomPatch(config: Config, random: () => number, step: number): ConfigPatch | undefined {
  const pick = <T,>(items: T[]): T | undefined =>
    items.length === 0 ? undefined : items[Math.floor(random() * items.length)];

  const object = pick(config.objects)!;
  const removable = config.objects.flatMap((o) =>
    o.fields.filter((f) => !f.system).map((f) => ({ object: o, field: f })),
  );
  const usedByPipeline = new Set(config.pipelines.map((p) => p.stageFieldId));
  const usedByAutomation = new Set(
    config.automations.flatMap((a) => [
      ...(a.trigger.type === "field_changed" || a.trigger.type === "date_reached" ? [a.trigger.fieldId] : []),
      ...flattenSteps(a.steps).flatMap((step) =>
        step.type === "set_field"
          ? [step.fieldId]
          : step.type === "filter"
            ? step.conditions.map((c) => c.fieldId)
            : step.type === "branch"
              ? step.paths.flatMap((path) => path.conditions.map((c) => c.fieldId))
              : [],
      ),
    ]),
  );
  const safeToRemove = removable.filter(
    (r) => !usedByPipeline.has(r.field.id) && !usedByAutomation.has(r.field.id),
  );

  switch (Math.floor(random() * 7)) {
    case 0:
      return {
        op: "add_field",
        objectKey: object.key,
        field: {
          id: `fld_gen_${step}`,
          key: `generated_${step}`,
          label: `Generated ${step}`,
          type: "text",
          required: false,
          system: false,
        },
      };
    case 1: {
      const target = pick(config.objects.flatMap((o) => o.fields));
      return target ? { op: "update_field", fieldId: target.id, label: `Renamed ${step}` } : undefined;
    }
    case 2: {
      const target = pick(safeToRemove);
      return target ? { op: "remove_field", fieldId: target.field.id } : undefined;
    }
    case 3: {
      const ids = object.fields.map((f) => f.id);
      return { op: "reorder_fields", objectKey: object.key, fieldIds: [...ids].reverse() };
    }
    case 4:
      return {
        op: "create_view",
        view: {
          id: `vw_gen_${step}`,
          objectKey: object.key,
          name: `Generated view ${step}`,
          renderer: "table",
          columns: object.fields.slice(0, 3).map((f) => f.id),
        },
      };
    case 5: {
      const view = pick(config.views);
      return view ? { op: "update_view", viewId: view.id, name: `Renamed view ${step}` } : undefined;
    }
    default: {
      const view = pick(config.views);
      return view ? { op: "delete_view", viewId: view.id } : undefined;
    }
  }
}

describe("twenty random patches, rolled back to any version", () => {
  for (const seed of [1, 7, 42, 1337, 90210]) {
    it(`holds for seed ${seed}`, () => {
      const random = prng(seed);
      const versions: Config[] = [defaultConfig()];

      for (let step = 0; step < 20; step++) {
        const current = versions[versions.length - 1]!;
        const patch = randomPatch(current, random, step);
        if (!patch) continue;
        try {
          versions.push(applyPatches(current, [patch]));
        } catch (error) {
          // A patch the config cannot accept must leave that config untouched.
          expect(error).toBeInstanceOf(PatchError);
          expect(versions[versions.length - 1]).toEqual(current);
        }
      }

      expect(versions.length).toBeGreaterThan(5);

      // Rolling back to any earlier version restores it exactly.
      const latest = versions[versions.length - 1]!;
      for (let target = 0; target < versions.length; target++) {
        const restored = applyPatch(latest, {
          op: "rollback",
          toVersion: target + 1,
          config: versions[target]!,
        });
        expect(restored).toEqual(versions[target]);
        // And the config we rolled back from is itself untouched.
        expect(versions[versions.length - 1]).toEqual(latest);
      }
    });
  }
});
