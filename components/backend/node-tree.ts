import type { UiNode } from "@/lib/config/types";
import { mintId } from "./ids";

/**
 * Editing a screen's node tree by path.
 *
 * The path format is the one `lib/runtime/screen.ts` already uses —
 * "root.children.2.children.0" — because the resolver keys every node's records
 * by that string. Using a second addressing scheme in the editor would mean two
 * ways to say where a node is, and one of them would eventually be wrong.
 *
 * Every function returns a new tree. `update_screen` replaces the whole root, so
 * an edit is one patch however deep it lands.
 */

export const ROOT = "root";

/** "root.children.2.children.0" -> [2, 0] */
export function indicesOf(path: string): number[] {
  return path
    .split(".")
    .filter((part) => /^\d+$/.test(part))
    .map(Number);
}

export function pathOf(indices: number[]): string {
  return [ROOT, ...indices.flatMap((index) => ["children", String(index)])].join(".");
}

export function parentPath(path: string): string | null {
  const indices = indicesOf(path);
  return indices.length === 0 ? null : pathOf(indices.slice(0, -1));
}

export function nodeAt(root: UiNode, path: string): UiNode | undefined {
  let node: UiNode | undefined = root;
  for (const index of indicesOf(path)) {
    node = node?.children?.[index];
  }
  return node;
}

function rewrite(root: UiNode, indices: number[], change: (node: UiNode) => UiNode | null): UiNode | null {
  if (indices.length === 0) return change(root);

  const [head, ...rest] = indices;
  const children = root.children ?? [];
  const child = children[head!];
  if (!child) return root;

  const next = rewrite(child, rest, change);
  const updated = next === null ? children.filter((_, index) => index !== head) : children.map((entry, index) => (index === head ? next : entry));

  return { ...root, children: updated };
}

/** Replaces one node, keeping everything above and below it. */
export function replaceNode(root: UiNode, path: string, node: UiNode): UiNode {
  return (rewrite(root, indicesOf(path), () => node) ?? root) as UiNode;
}

export function removeNode(root: UiNode, path: string): UiNode {
  if (path === ROOT) return root;
  return (rewrite(root, indicesOf(path), () => null) ?? root) as UiNode;
}

/** Adds a child to the container at `path`, at the end or at `index`. */
export function insertChild(root: UiNode, path: string, node: UiNode, index?: number): UiNode {
  return (
    (rewrite(root, indicesOf(path), (parent) => {
      const children = [...(parent.children ?? [])];
      children.splice(index ?? children.length, 0, node);
      return { ...parent, children };
    }) ?? root) as UiNode
  );
}

/** Reorders one container's children. */
export function moveChild(root: UiNode, path: string, from: number, to: number): UiNode {
  return (
    (rewrite(root, indicesOf(path), (parent) => {
      const children = [...(parent.children ?? [])];
      const [moved] = children.splice(from, 1);
      if (!moved) return parent;
      children.splice(to, 0, moved);
      return { ...parent, children };
    }) ?? root) as UiNode
  );
}

/**
 * A new node of each kind, with whatever the validator insists on already set.
 * A `table` without a query fails `screenRootSchema`, so adding one has to pick
 * an object — the editor asks, rather than staging a patch that cannot apply.
 */
export function newNode(kind: UiNode["kind"], objectKey: string, pipelineId?: string): UiNode {
  const base = { kind, id: mintId("nd") } as UiNode;

  switch (kind) {
    case "heading":
      return { ...base, text: "Heading" };
    case "text":
      return { ...base, text: "Some words about this screen." };
    case "badge":
      return { ...base, text: "Badge" };
    case "metric":
      return { ...base, label: "Total", aggregate: { fn: "count", objectKey: objectKey as never } };
    case "table":
    case "list":
      return { ...base, query: { objectKey: objectKey as never } };
    case "chart":
      return { ...base, query: { objectKey: objectKey as never }, chartType: "bar" };
    case "board":
      return { ...base, query: { objectKey: objectKey as never }, pipelineId: pipelineId ?? "" };
    case "form":
    case "record_detail":
      return { ...base, objectKey: objectKey as never };
    case "button":
      return { ...base, label: "Action", action: { type: "create_record", objectKey: objectKey as never } };
    case "grid":
      return { ...base, cols: 3, children: [] };
    case "stack":
    case "card":
    case "section":
    case "panel":
    case "tabs":
    case "tab":
      return { ...base, children: [] };
    default:
      return base;
  }
}

/** Gives every node in a tree an id, leaving the ones that have one alone. */
export function withIds(node: UiNode): UiNode {
  return {
    ...node,
    id: node.id ?? mintId("nd"),
    ...(node.children ? { children: node.children.map(withIds) } : {}),
  };
}
