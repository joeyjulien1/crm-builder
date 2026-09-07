import type { AutomationStep, BranchStep } from "@/lib/config/types";
import { mintId } from "./ids";

/**
 * Editing a workflow's steps as a tree.
 *
 * A lane is one ordered list of steps: the workflow itself, or the inside of
 * one branch path. `LanePath` names a lane the same way `StepCursor` names a
 * position (lib/automations/steps.ts) — pairs of `[stepIndex, pathIndex]`, with
 * `-1` for a branch's "otherwise" — so a cursor is just a lane path plus an
 * index, and the editor and the runner cannot disagree about where a step is.
 *
 * Every function here returns a new tree. The builder holds no draft state of
 * its own: an edit produces the next `steps` array and commits it as one
 * `update_automation` patch, which is what makes undo the rollback that already
 * exists.
 */
export type LanePath = number[];

export const OTHERWISE = -1;

export function laneAt(steps: AutomationStep[], lane: LanePath): AutomationStep[] {
  let list = steps;
  for (let depth = 0; depth + 1 < lane.length; depth += 2) {
    const step = list[lane[depth]!];
    if (!step || step.type !== "branch") return [];
    const which = lane[depth + 1]!;
    list = (which === OTHERWISE ? step.otherwise : step.paths[which]?.steps) ?? [];
  }
  return list;
}

/** Replaces one lane's contents, rebuilding the branches above it. */
export function replaceLane(
  steps: AutomationStep[],
  lane: LanePath,
  next: AutomationStep[],
): AutomationStep[] {
  if (lane.length === 0) return next;

  const [stepIndex, which, ...rest] = lane;
  return steps.map((step, index) => {
    if (index !== stepIndex || step.type !== "branch") return step;

    const inner = (nested: AutomationStep[]): AutomationStep[] =>
      rest.length > 0 ? replaceLane(nested, rest, next) : next;

    if (which === OTHERWISE) {
      return { ...step, otherwise: inner(step.otherwise ?? []) } satisfies BranchStep;
    }
    return {
      ...step,
      paths: step.paths.map((path, position) =>
        position === which ? { ...path, steps: inner(path.steps) } : path,
      ),
    } satisfies BranchStep;
  });
}

export function insertStep(
  steps: AutomationStep[],
  lane: LanePath,
  index: number,
  step: AutomationStep,
): AutomationStep[] {
  const list = [...laneAt(steps, lane)];
  list.splice(index, 0, step);
  return replaceLane(steps, lane, list);
}

export function removeStep(steps: AutomationStep[], lane: LanePath, index: number): AutomationStep[] {
  const list = laneAt(steps, lane).filter((_, position) => position !== index);
  return replaceLane(steps, lane, list);
}

export function moveStep(
  steps: AutomationStep[],
  lane: LanePath,
  from: number,
  to: number,
): AutomationStep[] {
  const list = [...laneAt(steps, lane)];
  const [moved] = list.splice(from, 1);
  if (!moved) return steps;
  list.splice(to, 0, moved);
  return replaceLane(steps, lane, list);
}

/** Rewrites one step in place, wherever it lives. */
export function updateStep(
  steps: AutomationStep[],
  lane: LanePath,
  index: number,
  next: AutomationStep,
): AutomationStep[] {
  const list = laneAt(steps, lane).map((step, position) => (position === index ? next : step));
  return replaceLane(steps, lane, list);
}

export function findStep(
  steps: AutomationStep[],
  lane: LanePath,
  index: number,
): AutomationStep | undefined {
  return laneAt(steps, lane)[index];
}

/** A new step of each kind, with defaults that already validate. */
export function newStep(type: AutomationStep["type"], objectKey: string): AutomationStep {
  const id = mintId("stp");

  switch (type) {
    case "filter":
      return { id, type: "filter", conditions: [] as never };
    case "delay":
      return { id, type: "delay", amount: 1, unit: "days" };
    case "branch":
      return {
        id,
        type: "branch",
        paths: [
          { id: mintId("pth"), label: "First path", conditions: [], steps: [] },
          { id: mintId("pth"), label: "Second path", conditions: [], steps: [] },
        ],
      };
    case "set_field":
      return { id, type: "set_field", fieldId: "", value: "" };
    case "create_record":
      return { id, type: "create_record", objectKey: objectKey as never, values: {} };
    case "create_task":
      return { id, type: "create_task", title: "Follow up", dueInDays: 1 };
    case "send_email":
      return { id, type: "send_email", to: "", subject: "", body: "" };
    case "call_webhook":
      return { id, type: "call_webhook", url: "", method: "POST" };
    case "send_slack":
      return { id, type: "send_slack", channel: "#general", text: "" };
    case "send_sms":
      return { id, type: "send_sms", to: "", body: "" };
  }
}

/**
 * Whether a step is complete enough to run. A half-configured step validates as
 * config but does nothing useful, so the builder marks it rather than letting
 * someone turn on a workflow that silently no-ops.
 */
export function stepIsIncomplete(step: AutomationStep): string | undefined {
  switch (step.type) {
    case "filter":
      return step.conditions.length === 0 ? "Add at least one condition." : undefined;
    case "set_field":
      return step.fieldId ? undefined : "Pick a field to update.";
    case "send_email":
      if (!step.to) return "Say who this goes to.";
      if (!step.subject) return "Add a subject.";
      if (!step.body) return "Add a message.";
      return undefined;
    case "call_webhook":
      return step.url ? undefined : "Add the URL to call.";
    case "send_slack":
      return step.text ? undefined : "Say what to post.";
    case "send_sms":
      if (!step.to) return "Say what number this goes to.";
      return step.body ? undefined : "Add a message.";
    case "branch":
      return step.paths.some((path) => path.conditions.length === 0)
        ? "One path has no conditions, so it always wins."
        : undefined;
    default:
      return undefined;
  }
}
