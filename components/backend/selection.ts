import type { LanePath } from "./step-tree";

/** The three things a workspace is made of, and the left rail's top level. */
export type Section = "data" | "screens" | "workflows";

/**
 * What the editor is pointed at. One selection drives all three panes: the tree
 * highlights it, the canvas scrolls to it, the inspector edits it.
 */
export type Selection =
  | { kind: "object"; objectKey: string }
  | { kind: "field"; objectKey: string; fieldId: string }
  | { kind: "screen"; screenId: string }
  | { kind: "node"; screenId: string; path: string }
  | { kind: "workflow"; automationId: string }
  | { kind: "trigger"; automationId: string }
  | { kind: "step"; automationId: string; lane: LanePath; index: number };

export function sectionFor(selection: Selection | null): Section | null {
  if (!selection) return null;
  if (selection.kind === "object" || selection.kind === "field") return "data";
  if (selection.kind === "screen" || selection.kind === "node") return "screens";
  return "workflows";
}

export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === null || b === null) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}
