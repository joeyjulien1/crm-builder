import type {
  AutomationConfig,
  AutomationStep,
  Config,
  FilterCondition,
  ObjectConfig,
  ScreenConfig,
  UiNode,
} from "@/lib/config/types";
import { OPERATOR_LABELS } from "@/lib/config/controls";

/**
 * Config, read out loud.
 *
 * Everything the backend editor shows above the inspector is a sentence, not a
 * key-value dump: "When a deal is updated", "Waits 2 days", "Emails
 * {{owner_email}}". These are the functions that produce them, kept together
 * because the tree, the step cards and the run log must all describe the same
 * workflow the same way.
 */

export function objectFor(config: Config, objectKey: string): ObjectConfig | undefined {
  return config.objects.find((object) => object.key === objectKey);
}

export function fieldFor(config: Config, fieldId: string) {
  for (const object of config.objects) {
    const field = object.fields.find((candidate) => candidate.id === fieldId);
    if (field) return { object, field };
  }
  return undefined;
}

export function describeTrigger(automation: AutomationConfig, config: Config): string {
  const trigger = automation.trigger;
  const object = objectFor(config, trigger.objectKey);
  const singular = object?.label.toLowerCase() ?? trigger.objectKey;

  switch (trigger.type) {
    case "record_created":
      return `When a ${singular} is created`;
    case "record_updated":
      return `When a ${singular} is updated`;
    case "field_changed":
      return `When ${fieldFor(config, trigger.fieldId)?.field.label ?? "a field"} changes`;
    case "date_reached": {
      const field = fieldFor(config, trigger.fieldId)?.field.label ?? "a date";
      if (trigger.offsetDays === 0) return `When ${field} is reached`;
      const distance = Math.abs(trigger.offsetDays);
      return `${distance} ${distance === 1 ? "day" : "days"} ${trigger.offsetDays < 0 ? "before" : "after"} ${field}`;
    }
    case "form_submitted":
      return `When a ${singular} form is submitted`;
    case "webhook_received":
      return `When a webhook posts a ${singular}`;
    case "schedule": {
      if (trigger.cadence === "weekly") {
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        return `Every ${days[trigger.weekday ?? 1]}, for every ${singular}`;
      }
      if (trigger.cadence === "monthly") {
        return `On day ${trigger.dayOfMonth ?? 1} of the month, for every ${singular}`;
      }
      return `Every day, for every ${singular}`;
    }
  }
}

function printableValue(value: unknown): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

export function describeCondition(condition: FilterCondition, config: Config): string {
  const field = fieldFor(config, condition.fieldId)?.field.label ?? condition.fieldId;
  const operator = OPERATOR_LABELS[condition.operator] ?? condition.operator;
  const value = printableValue(condition.value);
  return value ? `${field} ${operator} ${value}` : `${field} ${operator}`;
}

export function describeConditions(conditions: FilterCondition[], config: Config): string {
  if (conditions.length === 0) return "Always";
  return conditions.map((condition) => describeCondition(condition, config)).join(" and ");
}

/** A step's title and its supporting line, as the step card renders them. */
export function describeStep(step: AutomationStep, config: Config): { title: string; detail: string } {
  switch (step.type) {
    case "set_field": {
      const field = fieldFor(config, step.fieldId)?.field.label ?? step.fieldId;
      return { title: `Set ${field}`, detail: `Change the value to ${printableValue(step.value) || "empty"}.` };
    }
    case "create_record": {
      const object = objectFor(config, step.objectKey);
      const count = Object.keys(step.values).length;
      return {
        title: `Create ${object?.label.toLowerCase() ?? step.objectKey}`,
        detail: `${count} ${count === 1 ? "field" : "fields"} set on creation.`,
      };
    }
    case "create_task":
      return {
        title: `Create task: ${step.title}`,
        detail: step.dueInDays === 0 ? "Due immediately." : `Due in ${step.dueInDays} ${step.dueInDays === 1 ? "day" : "days"}.`,
      };
    case "send_email":
      return { title: `Email ${step.to}`, detail: step.subject };
    case "call_webhook":
      return { title: `${step.method} webhook`, detail: step.url };
    case "send_slack":
      return { title: `Post to ${step.channel}`, detail: step.text };
    case "send_sms":
      return { title: `Text ${step.to}`, detail: step.body };
    case "filter":
      return { title: "Only continue if", detail: describeConditions(step.conditions, config) };
    case "delay": {
      const unit = step.amount === 1 ? step.unit.replace(/s$/, "") : step.unit;
      return { title: `Wait ${step.amount} ${unit}`, detail: "The rest of the workflow runs after this." };
    }
    case "branch":
      return {
        title: `Branch ${step.paths.length} ${step.paths.length === 1 ? "way" : "ways"}`,
        detail: step.paths.map((path) => path.label).join(", "),
      };
  }
}

/** Which objects a screen reads, by walking its tree. */
export function screenDataSources(screen: ScreenConfig): string[] {
  // A coded screen declares what it reads by calling the data client, which
  // this cannot see from here. The runtime knows; a static walk does not.
  if (!screen.root) return [];
  const reads = new Set<string>();
  const walk = (node: UiNode): void => {
    if (node.query?.objectKey) reads.add(node.query.objectKey);
    if (node.aggregate?.objectKey) reads.add(node.aggregate.objectKey);
    if (node.objectKey) reads.add(node.objectKey);
    node.children?.forEach(walk);
  };
  walk(screen.root);
  return [...reads];
}

export function screenComponentCounts(screen: ScreenConfig): Map<string, number> {
  const counts = new Map<string, number>();
  if (!screen.root) return counts;
  const walk = (node: UiNode): void => {
    counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    node.children?.forEach(walk);
  };
  walk(screen.root);
  return counts;
}

export function screenSummary(screen: ScreenConfig): string {
  if (screen.source) {
    const lines = screen.source.split(/\r?\n/).length;
    return `Written as code, ${lines} ${lines === 1 ? "line" : "lines"}`;
  }
  const counts = screenComponentCounts(screen);
  const visibleKinds = ["table", "board", "list", "chart", "metric", "form", "record_detail"];
  const parts = visibleKinds
    .map((kind) => [kind, counts.get(kind) ?? 0] as const)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kind.replace("_", " ")}${count === 1 ? "" : "s"}`);
  return parts.join(", ") || "Configured screen";
}

/** A node's own label in the structure tree, Shopify's rule: its name, else its kind. */
export function nodeLabel(node: UiNode): string {
  const own = node.label ?? node.text;
  if (own && own.trim()) return own.length > 40 ? `${own.slice(0, 40)}…` : own;
  if (node.query?.objectKey) return `${sentence(node.kind)} of ${node.query.objectKey}`;
  if (node.aggregate) return `${node.aggregate.fn} of ${node.aggregate.objectKey}`;
  if (node.objectKey) return `${sentence(node.kind)} — ${node.objectKey}`;
  return sentence(node.kind);
}

function sentence(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Whether this workspace has anything saved worth exploring. */
export function hasBuiltBackend(config: Config): boolean {
  if (config.brand?.layoutStyle !== "blank") return true;
  return (
    (config.screens ?? []).length > 0 ||
    (config.views ?? []).length > 0 ||
    (config.automations ?? []).length > 0
  );
}
