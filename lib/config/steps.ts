import type { AutomationConfig, AutomationStep } from "./types";
import { flattenSteps } from "./schema";

/**
 * Whether a step is finished enough to run.
 *
 * Every edit in the backend editor commits a patch, so a step has to be
 * *storable* the moment it is added — before anyone has typed the email
 * address. The schema therefore accepts a half-written step, and this is where
 * "half-written" is defined instead.
 *
 * The guarantee moves to turning the workflow on: `set_automation_enabled`
 * refuses while anything here has something to say, and the runner refuses too.
 * A workflow you cannot switch on is a draft; a workflow that runs and silently
 * does nothing is a bug report six weeks later.
 */
export function stepIsIncomplete(step: AutomationStep): string | undefined {
  switch (step.type) {
    case "filter":
      return step.conditions.length === 0 ? "Add at least one condition." : undefined;

    case "set_field":
      return step.fieldId ? undefined : "Pick a field to update.";

    case "create_task":
      return step.title.trim() ? undefined : "Give the task a title.";

    case "send_email":
      if (!step.to.trim()) return "Say who this goes to.";
      if (!step.subject.trim()) return "Add a subject.";
      if (!step.body.trim()) return "Add a message.";
      return undefined;

    case "send_slack":
      if (!step.channel.trim()) return "Say which channel.";
      return step.text.trim() ? undefined : "Say what to post.";

    case "send_sms":
      if (!step.to.trim()) return "Say what number this goes to.";
      return step.body.trim() ? undefined : "Add a message.";

    case "call_webhook":
      return step.url.trim() ? undefined : "Add the URL to call.";

    case "branch":
      return step.paths.some((path) => path.conditions.length === 0)
        ? "One path has no conditions, so it always wins."
        : undefined;

    case "create_record":
    case "delay":
      return undefined;
  }
}

/** Every unfinished step in a workflow, in run order, with what it needs. */
export function incompleteSteps(automation: AutomationConfig): { step: AutomationStep; problem: string }[] {
  return flattenSteps(automation.steps).flatMap((step) => {
    const problem = stepIsIncomplete(step);
    return problem ? [{ step, problem }] : [];
  });
}
