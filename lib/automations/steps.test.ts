import { describe, expect, it } from "vitest";
import { advance, enterBranch, OTHERWISE, parseCursor, START, stepAt } from "./steps";
import type { AutomationStep } from "@/lib/config/types";

/**
 * The walker is where a delay can go wrong in a way nobody notices: a run that
 * resumes one step early does its last action twice, and one that resumes one
 * step late skips it. Both look like "the automation is flaky".
 */
const steps: AutomationStep[] = [
  { id: "a", type: "create_task", title: "First", dueInDays: 0 },
  {
    id: "b",
    type: "branch",
    paths: [
      {
        id: "p1",
        label: "Big",
        conditions: [],
        steps: [
          { id: "b1", type: "create_task", title: "Inside big", dueInDays: 0 },
          { id: "b2", type: "delay", amount: 1, unit: "days" },
          { id: "b3", type: "create_task", title: "After the wait", dueInDays: 0 },
        ],
      },
      { id: "p2", label: "Small", conditions: [], steps: [] },
    ],
    otherwise: [{ id: "o1", type: "create_task", title: "Neither", dueInDays: 0 }],
  },
  { id: "c", type: "create_task", title: "Last", dueInDays: 0 },
];

describe("the step cursor", () => {
  it("starts at the first step", () => {
    expect(stepAt(steps, START)?.id).toBe("a");
  });

  it("walks siblings in order", () => {
    expect(stepAt(steps, advance(steps, [0]))?.id).toBe("b");
    expect(stepAt(steps, advance(steps, [1]))?.id).toBe("c");
  });

  it("ends with an empty cursor rather than running off the end", () => {
    expect(advance(steps, [2])).toEqual([]);
    expect(stepAt(steps, [])).toBeUndefined();
  });

  it("descends into the path that was chosen", () => {
    expect(stepAt(steps, enterBranch(steps, [1], 0))?.id).toBe("b1");
    expect(stepAt(steps, enterBranch(steps, [1], OTHERWISE))?.id).toBe("o1");
  });

  it("carries on after the branch when the chosen path is empty", () => {
    // The second path has no steps, so entering it is the same as finishing it.
    expect(stepAt(steps, enterBranch(steps, [1], 1))?.id).toBe("c");
  });

  it("comes back out of a branch to the step after it", () => {
    const inside = enterBranch(steps, [1], 0);
    const afterDelay = advance(steps, advance(steps, inside));
    expect(stepAt(steps, afterDelay)?.id).toBe("b3");
    // And past the last step in the path, back out to the top level.
    expect(stepAt(steps, advance(steps, afterDelay))?.id).toBe("c");
  });

  it("resumes exactly where a delay left off", () => {
    // This is the sequence a delayed run actually stores and reads back.
    const atDelay = advance(steps, enterBranch(steps, [1], 0));
    expect(stepAt(steps, atDelay)?.type).toBe("delay");

    const resumeAt = advance(steps, atDelay);
    const roundTripped = parseCursor(JSON.parse(JSON.stringify(resumeAt)));
    expect(roundTripped).toEqual(resumeAt);
    expect(stepAt(steps, roundTripped!)?.id).toBe("b3");
  });

  it("refuses a cursor that is not one", () => {
    expect(parseCursor(undefined)).toBeUndefined();
    expect(parseCursor([])).toBeUndefined();
    expect(parseCursor([0, 1])).toBeUndefined();
    expect(parseCursor(["0"])).toBeUndefined();
    expect(parseCursor([0, -2, 0])).toBeUndefined();
  });

  it("gives up rather than guessing when the workflow has changed underneath it", () => {
    // A cursor written against a tree whose branch has since been deleted.
    const shortened: AutomationStep[] = [steps[0]!];
    expect(stepAt(shortened, [1, 0, 0])).toBeUndefined();
    expect(advance(shortened, [1, 0, 0])).toEqual([]);
  });
});
