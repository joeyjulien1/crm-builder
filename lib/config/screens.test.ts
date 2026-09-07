import { describe, expect, it } from "vitest";
import { defaultConfig } from "./default";
import { applyPatch, applyPatches, parsePatch, PatchError, validateConfig } from "./patch";
import { describePatch } from "./describe";
import type { Config, UiNode } from "./types";

const base = defaultConfig();
const nameField = base.objects.find((o) => o.key === "contact")!.fields[0]!.id;

function screen(root: UiNode, name = "Today") {
  return { op: "create_screen" as const, screen: { id: "scr_1", name, position: 0, root } };
}

const dashboard: UiNode = {
  kind: "stack",
  children: [
    { kind: "heading", text: "Today" },
    {
      kind: "grid",
      cols: 3,
      children: [
        { kind: "metric", label: "Contacts", aggregate: { fn: "count", objectKey: "contact" } },
        { kind: "metric", label: "Deals", aggregate: { fn: "count", objectKey: "deal" } },
      ],
    },
    {
      kind: "stack",
      direction: "row",
      children: [
        { kind: "table", query: { objectKey: "contact" }, columns: [nameField], style: { grow: true } },
        { kind: "panel", side: "right", children: [{ kind: "form", objectKey: "contact", fields: [nameField] }] },
      ],
    },
  ],
};

describe("composing a screen", () => {
  it("accepts a tree nested to whatever shape the layout needs", () => {
    const next = applyPatches(base, [screen(dashboard)]);
    expect(next.screens).toHaveLength(1);
    expect(next.screens[0]!.root!.children).toHaveLength(3);
    expect(() => validateConfig(next)).not.toThrow();
  });

  it("makes a data node say what it reads", () => {
    expect(() => parsePatch(screen({ kind: "table" }))).toThrow(PatchError);
    expect(() => parsePatch(screen({ kind: "table", query: { objectKey: "contact" } }))).not.toThrow();
  });

  it("makes a metric say what it counts", () => {
    expect(() => parsePatch(screen({ kind: "metric", label: "x" }))).toThrow(PatchError);
    // sum needs something to sum
    expect(() =>
      parsePatch(screen({ kind: "metric", aggregate: { fn: "sum", objectKey: "deal" } })),
    ).toThrow(PatchError);
    expect(() =>
      parsePatch(screen({ kind: "metric", aggregate: { fn: "sum", objectKey: "deal", fieldId: "fld_x" } })),
    ).not.toThrow();
  });

  it("refuses children on a node that cannot hold them", () => {
    expect(() =>
      parsePatch(screen({ kind: "heading", text: "x", children: [{ kind: "text", text: "y" }] })),
    ).toThrow(PatchError);
  });

  it("refuses a board with no pipeline to draw columns from", () => {
    expect(() => parsePatch(screen({ kind: "board", query: { objectKey: "deal" } }))).toThrow(PatchError);
  });

  it("stops runaway nesting", () => {
    let node: UiNode = { kind: "text", text: "deep" };
    for (let i = 0; i < 12; i++) node = { kind: "stack", children: [node] };
    expect(() => parsePatch(screen(node))).toThrow(PatchError);
  });

  it("refuses a style value that is not a token", () => {
    expect(() =>
      parsePatch(screen({ kind: "stack", style: { pad: "23px" } as never })),
    ).toThrow(PatchError);
  });

  it("refuses two screens with the same name", () => {
    const once = applyPatches(base, [screen(dashboard, "Today")]);
    expect(() =>
      applyPatches(once, [{ op: "create_screen", screen: { id: "scr_2", name: "Today", position: 1, root: dashboard } }]),
    ).toThrow(PatchError);
  });

  it("replaces the whole tree on update, and round-trips through a rollback", () => {
    const before: Config = applyPatches(base, [screen(dashboard)]);
    const after = applyPatches(before, [
      { op: "update_screen", screenId: "scr_1", root: { kind: "stack", children: [{ kind: "heading", text: "New" }] } },
    ]);
    expect(after.screens[0]!.root!.children).toHaveLength(1);

    const restored = applyPatch(after, { op: "rollback", toVersion: 1, config: before });
    expect(restored.screens).toEqual(before.screens);
  });

  it("deletes cleanly", () => {
    const before = applyPatches(base, [screen(dashboard)]);
    const after = applyPatches(before, [{ op: "delete_screen", screenId: "scr_1" }]);
    expect(after.screens).toHaveLength(0);
    expect(() => applyPatches(after, [{ op: "delete_screen", screenId: "scr_1" }])).toThrow(PatchError);
  });


  it("rejects a filter that can never be true", () => {
    // "not closed and not lost", written wrong — reads 0 for ever.
    const impossible = screen({
      kind: "metric",
      label: "Active",
      aggregate: {
        fn: "count",
        objectKey: "contact",
        filters: {
          join: "and",
          conditions: [
            { fieldId: "fld_stage", operator: "is", value: "closed" },
            { fieldId: "fld_stage", operator: "is", value: "lost" },
          ],
          groups: [],
        },
      },
    });
    expect(() => parsePatch(impossible)).toThrow(PatchError);

    // The same intent, expressed correctly.
    const fixed = screen({
      kind: "metric",
      label: "Active",
      aggregate: {
        fn: "count",
        objectKey: "contact",
        filters: {
          join: "and",
          conditions: [
            { fieldId: "fld_stage", operator: "is_not", value: "closed" },
            { fieldId: "fld_stage", operator: "is_not", value: "lost" },
          ],
          groups: [],
        },
      },
    });
    expect(() => parsePatch(fixed)).not.toThrow();
  });

  it("rejects two metrics that count exactly the same thing", () => {
    const duplicated = screen({
      kind: "grid",
      cols: 2,
      children: [
        { kind: "metric", label: "Open", aggregate: { fn: "count", objectKey: "activity" } },
        { kind: "metric", label: "This week", aggregate: { fn: "count", objectKey: "activity" } },
      ],
    });
    expect(() => parsePatch(duplicated)).toThrow(PatchError);
  });

  it("allows metrics that differ only by their filter", () => {
    const distinct = screen({
      kind: "grid",
      cols: 2,
      children: [
        {
          kind: "metric",
          label: "Open",
          aggregate: {
            fn: "count",
            objectKey: "activity",
            filters: { join: "and", conditions: [{ fieldId: "fld_done", operator: "is_false" }], groups: [] },
          },
        },
        {
          kind: "metric",
          label: "Done",
          aggregate: {
            fn: "count",
            objectKey: "activity",
            filters: { join: "and", conditions: [{ fieldId: "fld_done", operator: "is_true" }], groups: [] },
          },
        },
      ],
    });
    expect(() => parsePatch(distinct)).not.toThrow();
  });

  it("describes itself for the diff in terms of what the user will see", () => {
    const description = describePatch(screen(dashboard), base);
    expect(description).toContain("Today");
    expect(description).toContain("2 metrics");
    expect(description).toContain("1 table");
  });
});
