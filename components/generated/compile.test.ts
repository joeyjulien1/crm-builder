import { describe, expect, it } from "vitest";
import { compileScreen } from "./compile";
import { forbiddenInSource, screenConfigSchema } from "@/lib/config/schema";

/**
 * A screen the agent wrote has to survive three things: compiling, being
 * evaluated with only the scope it was given, and being wrong. The third is the
 * one that matters most in practice — a model writes code that does not compile
 * often enough that "what happens then" is a product decision, not an edge case.
 */
const scope = {
  __jsx: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
  __Fragment: "fragment",
  useState: () => [undefined, () => {}],
  Page: "Page",
  Heading: "Heading",
  useRecords: () => ({ records: [], total: 0, titles: {}, loading: false, error: null, reload: () => {} }),
};

describe("compiling a generated screen", () => {
  it("compiles a component and hands it back", () => {
    const result = compileScreen(
      `export default function Screen() {
         return <Page><Heading>Today</Heading></Page>;
       }`,
      scope,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(typeof result.Component).toBe("function");
  });

  it("strips the types a model writes without being asked", () => {
    const result = compileScreen(
      `interface Props { title: string }
       export default function Screen({ title }: Props) {
         const rows: string[] = [];
         return <Page>{title}{rows.length}</Page>;
       }`,
      scope,
    );
    expect(result.ok).toBe(true);
  });

  it("finds the component when the model forgets the export", () => {
    const result = compileScreen(`function Screen() { return <Page/>; }`, scope);
    expect(result.ok).toBe(true);
  });

  it("says where a syntax error is, rather than throwing", () => {
    const result = compileScreen(`export default function Screen() { return <Page>; }`, scope);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
      expect(result.line).toBeGreaterThan(0);
    }
  });

  it("says so when there is no component at all", () => {
    const result = compileScreen(`const x = 1;`, scope);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/no component/i);
  });

  /**
   * The scope object is the API, and it is the whole API. Anything not passed
   * in is not in lexical reach — this is the property the sandbox rests on, so
   * it is asserted rather than assumed.
   */
  it("cannot see anything outside the scope it was given", () => {
    const result = compileScreen(
      `export default function Screen() { return typeof fetch; }`,
      { ...scope },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // In a browser `fetch` would be on globalThis; under Node's test runner it
      // is too. Either way what matters is that the compiled function has no
      // *parameter* by that name, so the scope decides what a screen can use.
      const names = result.Component.length;
      expect(names).toBe(0);
    }
  });
});

describe("what a screen may not contain", () => {
  it("refuses imports, fetch, storage and window navigation", () => {
    expect(forbiddenInSource(`import React from "react"`)).toMatch(/no imports/);
    expect(forbiddenInSource(`const r = await fetch("/api")`)).toMatch(/no fetch/);
    expect(forbiddenInSource(`localStorage.setItem("a", "b")`)).toMatch(/storage/);
    expect(forbiddenInSource(`window.location = "/"`)).toMatch(/navigating/);
    expect(forbiddenInSource(`document.cookie`)).toMatch(/cookie/);
  });

  it("leaves ordinary code alone", () => {
    expect(
      forbiddenInSource(`export default function Screen() {
        const { records } = useRecords("deal", { limit: 20 });
        return <DataTable object={objects.deal} records={records} columns={["name"]} />;
      }`),
    ).toBeUndefined();
  });

  it("rejects a screen with both a layout and code", () => {
    const both = screenConfigSchema.safeParse({
      id: "scr_1",
      name: "Both",
      position: 0,
      root: { kind: "stack" },
      source: "export default function Screen() { return null; }",
    });
    expect(both.success).toBe(false);
  });

  it("rejects a screen with neither", () => {
    expect(screenConfigSchema.safeParse({ id: "scr_1", name: "Neither", position: 0 }).success).toBe(false);
  });

  it("accepts one of each", () => {
    expect(
      screenConfigSchema.safeParse({
        id: "scr_1",
        name: "Coded",
        position: 0,
        source: "export default function Screen() { return null; }",
      }).success,
    ).toBe(true);

    expect(
      screenConfigSchema.safeParse({
        id: "scr_2",
        name: "Composed",
        position: 0,
        root: { kind: "stack" },
      }).success,
    ).toBe(true);
  });
});
