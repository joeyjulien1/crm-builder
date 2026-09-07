import type { AutomationStep } from "@/lib/config/types";

/**
 * Walking a workflow's steps, one position at a time.
 *
 * A run used to be a `for` loop over an array, which is fine until a step can
 * suspend. A delay has to say *where to carry on*, survive being written to a
 * job payload, and mean the same thing when the resumed job reads it back — so
 * the position is data, not a loop variable.
 *
 * A cursor is a list of indices with the branch descents interleaved:
 *
 *   [2]            the third top-level step
 *   [2, 0, 1]      inside that branch's first path, the second step
 *   [2, -1, 0]     inside that branch's `otherwise`, the first step
 *
 * so a cursor is always odd-length, and `-1` is the only special value.
 */
export type StepCursor = number[];

/** Where a run starts: the first step, if there is one. */
export const START: StepCursor = [0];

export const OTHERWISE = -1;

interface Position {
  list: AutomationStep[];
  index: number;
}

function locate(steps: AutomationStep[], cursor: StepCursor): Position | undefined {
  if (cursor.length === 0 || cursor.length % 2 === 0) return undefined;

  let list = steps;
  for (let depth = 0; depth + 1 < cursor.length; depth += 2) {
    const step = list[cursor[depth]!];
    if (!step || step.type !== "branch") return undefined;

    const which = cursor[depth + 1]!;
    const nested = which === OTHERWISE ? step.otherwise : step.paths[which]?.steps;
    if (!nested) return undefined;
    list = nested;
  }

  return { list, index: cursor[cursor.length - 1]! };
}

/** The step a cursor points at, or undefined when it points past the end. */
export function stepAt(steps: AutomationStep[], cursor: StepCursor): AutomationStep | undefined {
  const position = locate(steps, cursor);
  return position?.list[position.index];
}

/**
 * The next position in run order: the following sibling, or — at the end of a
 * branch — the step after the branch itself, however deeply nested. Returns an
 * empty cursor when the workflow is finished.
 */
export function advance(steps: AutomationStep[], cursor: StepCursor): StepCursor {
  const next = [...cursor];

  while (next.length > 0) {
    const position = locate(steps, next);
    if (position) {
      const sibling = next[next.length - 1]! + 1;
      if (sibling < position.list.length) {
        next[next.length - 1] = sibling;
        return next;
      }
    }
    // Out of siblings: step back out of this branch and try its parent.
    next.splice(-2);
  }

  return [];
}

/**
 * Descend into a branch. `which` is the index of the path whose conditions
 * held, or OTHERWISE. An empty path is not an error — the run simply carries on
 * after the branch.
 */
export function enterBranch(
  steps: AutomationStep[],
  cursor: StepCursor,
  which: number,
): StepCursor {
  const step = stepAt(steps, cursor);
  if (!step || step.type !== "branch") return advance(steps, cursor);

  const nested = which === OTHERWISE ? step.otherwise : step.paths[which]?.steps;
  if (!nested || nested.length === 0) return advance(steps, cursor);

  return [...cursor, which, 0];
}

/** A cursor as a string, for idempotency keys and run logs. */
export function printCursor(cursor: StepCursor): string {
  return cursor.join(".");
}

/** Reads a cursor back off a job payload, rejecting anything malformed. */
export function parseCursor(value: unknown): StepCursor | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length % 2 === 0) return undefined;
  if (!value.every((entry) => Number.isInteger(entry) && entry >= OTHERWISE)) return undefined;
  return value as StepCursor;
}

/** How long a delay step waits, in milliseconds. */
export function delayMs(amount: number, unit: "minutes" | "hours" | "days"): number {
  const minute = 60_000;
  if (unit === "minutes") return amount * minute;
  if (unit === "hours") return amount * 60 * minute;
  return amount * 24 * 60 * minute;
}
