import { findField, findObject } from "./patch";
import type {
  AutomationAction,
  AutomationConfig,
  AutomationStep,
  Config,
  ConfigPatch,
  UiNode,
} from "./types";

/**
 * Turns a patch into a sentence a salesperson can approve. ConfigDiff shows
 * this, never JSON — it is the trust surface of the whole product.
 */
export function describePatch(patch: ConfigPatch, before: Config): string {
  switch (patch.op) {
    case "add_field": {
      const object = findObject(before, patch.objectKey);
      const required = patch.field.required ? ", required" : "";
      return `Adds a ${patch.field.label} field (${fieldTypeLabel(patch.field.type)}${required}) to ${object?.labelPlural ?? patch.objectKey}`;
    }

    case "update_field": {
      const found = findField(before, patch.fieldId);
      if (!found) return `Updates a field`;
      const changes: string[] = [];
      if (patch.label && patch.label !== found.field.label) changes.push(`renames it to ${patch.label}`);
      if (patch.required !== undefined && patch.required !== found.field.required) {
        changes.push(patch.required ? "makes it required" : "makes it optional");
      }
      if (patch.options) {
        const existing = new Set((found.field.options ?? []).map((o) => o.value));
        const proposed = new Set(patch.options.map((o) => o.value));
        const added = patch.options.filter((o) => !existing.has(o.value)).map((o) => o.label);
        const removed = (found.field.options ?? []).filter((o) => !proposed.has(o.value)).map((o) => o.label);
        if (added.length) changes.push(`adds the ${list(added)} ${plural(added.length, "option")}`);
        if (removed.length) changes.push(`removes the ${list(removed)} ${plural(removed.length, "option")}`);
      }
      if (patch.default !== undefined) changes.push("changes its default");
      if (patch.helpText !== undefined) changes.push("changes its help text");
      const summary = changes.length ? changes.join(", ") : "leaves it unchanged";
      return `Changes ${found.field.label} on ${found.object.labelPlural}: ${summary}`;
    }

    case "remove_field": {
      const found = findField(before, patch.fieldId);
      if (!found) return `Removes a field`;
      return `Removes ${found.field.label} from ${found.object.labelPlural}`;
    }

    case "create_relation":
      return `Links ${patch.relation.fromObject} to ${patch.relation.toObject} as "${patch.relation.label}"`;

    case "reorder_fields": {
      const object = findObject(before, patch.objectKey);
      return `Reorders the fields on ${object?.labelPlural ?? patch.objectKey}`;
    }

    case "create_view": {
      const object = findObject(before, patch.view.objectKey);
      return `Adds a ${rendererLabel(patch.view.renderer)} called "${patch.view.name}" to ${object?.labelPlural ?? patch.view.objectKey}`;
    }

    case "update_view": {
      const view = before.views.find((v) => v.id === patch.viewId);
      if (!view) return `Updates a view`;
      const changes: string[] = [];
      if (patch.name && patch.name !== view.name) changes.push(`renames it to "${patch.name}"`);
      if (patch.columns) changes.push(`shows ${patch.columns.length} ${plural(patch.columns.length, "column")}`);
      if (patch.filters !== undefined) changes.push(patch.filters ? "changes its filters" : "clears its filters");
      if (patch.sort !== undefined) changes.push(patch.sort ? "changes its sort order" : "clears its sort order");
      if (patch.groupBy !== undefined) changes.push(patch.groupBy ? "groups it" : "ungroups it");
      return `Changes the "${view.name}" view: ${changes.length ? changes.join(", ") : "no visible change"}`;
    }

    case "delete_view": {
      const view = before.views.find((v) => v.id === patch.viewId);
      return `Deletes the "${view?.name ?? patch.viewId}" view`;
    }

    case "create_pipeline":
      return `Adds the ${patch.pipeline.name} pipeline with ${patch.pipeline.stages.length} stages: ${list(patch.pipeline.stages.map((s) => s.label))}`;

    case "update_pipeline": {
      const pipeline = before.pipelines.find((p) => p.id === patch.pipelineId);
      if (!pipeline) return `Updates a pipeline`;
      if (!patch.stages) return `Renames the ${pipeline.name} pipeline to ${patch.name ?? pipeline.name}`;
      const nextKeys = new Set(patch.stages.map((s) => s.key));
      const existingKeys = new Set(pipeline.stages.map((s) => s.key));
      const removed = pipeline.stages.filter((s) => !nextKeys.has(s.key)).map((s) => s.label);
      const added = patch.stages.filter((s) => !existingKeys.has(s.key)).map((s) => s.label);
      const parts: string[] = [];
      if (added.length) parts.push(`adds ${list(added)}`);
      if (removed.length) {
        const targets = (patch.stageMigrations ?? []).map((m) => {
          const to = patch.stages?.find((s) => s.key === m.to);
          return to?.label ?? m.to;
        });
        parts.push(`removes ${list(removed)}, moving those records to ${list([...new Set(targets)])}`);
      }
      return `Changes the ${pipeline.name} pipeline: ${parts.length ? parts.join(", ") : "reorders its stages"}`;
    }

    case "create_automation":
      return `Adds the "${patch.automation.name}" automation: ${describeTrigger(patch.automation, before)}, then ${list(patch.automation.steps.map(describeStep))}`;

    case "update_automation": {
      const automation = before.automations.find((a) => a.id === patch.automationId);
      const name = automation?.name ?? patch.automationId;
      const steps = patch.steps ?? (patch.actions as AutomationStep[] | undefined);
      if (!steps) return `Changes the "${name}" automation`;
      return `Changes what the "${name}" automation does: ${list(steps.map(describeStep))}`;
    }

    case "set_automation_enabled": {
      const automation = before.automations.find((a) => a.id === patch.automationId);
      return `${patch.enabled ? "Turns on" : "Turns off"} the "${automation?.name ?? patch.automationId}" automation`;
    }

    case "update_brand":
      return `Customizes workspace brand to "${patch.brand.name ?? before.brand?.name ?? "CRM Studio"}"${patch.brand.tagline ? ` ("${patch.brand.tagline}")` : ""}${patch.brand.logoFileId ? " with an uploaded logo" : ""}`;

    case "create_screen": {
      const summary = patch.screen.root ? summariseScreen(patch.screen.root) : "written as code";
      return `Builds a "${patch.screen.name}" screen${summary ? ` — ${summary}` : ""}`;
    }

    case "update_screen": {
      const screen = before.screens.find((candidate) => candidate.id === patch.screenId);
      const name = patch.name ?? screen?.name ?? patch.screenId;
      if (patch.root) {
        const summary = summariseScreen(patch.root);
        return `Rebuilds the "${name}" screen${summary ? ` — ${summary}` : ""}`;
      }
      return `Renames a screen to "${name}"`;
    }

    case "delete_screen": {
      const screen = before.screens.find((candidate) => candidate.id === patch.screenId);
      return `Deletes the "${screen?.name ?? patch.screenId}" screen`;
    }

    case "update_theme": {
      // Named in the terms the user used, not as variable names.
      const parts: string[] = [];
      const theme = patch.theme;

      if (theme.mode) parts.push(`switches to ${theme.mode} mode`);
      if (theme.colors?.accent) parts.push(`sets the accent to ${theme.colors.accent}`);
      if (theme.colors?.surface) parts.push(`repaints the background ${theme.colors.surface}`);

      const otherColours = Object.keys(theme.colors ?? {}).filter(
        (key) => key !== "accent" && key !== "surface",
      ).length;
      if (otherColours > 0) parts.push(`adjusts ${otherColours} more ${otherColours === 1 ? "colour" : "colours"}`);

      if (theme.type?.fontBody || theme.type?.fontDisplay) {
        parts.push(`changes the typeface to ${theme.type.fontDisplay ?? theme.type.fontBody}`);
      }
      if (theme.type?.baseSize) parts.push(`sets body text to ${theme.type.baseSize}px`);
      if (theme.space?.rowHeight) parts.push(`sets rows to ${theme.space.rowHeight}px`);
      if (theme.space?.unit) parts.push(`retunes the spacing scale`);
      if (theme.shape?.radiusMd !== undefined) {
        parts.push(theme.shape.radiusMd === 0 ? "squares off the corners" : `rounds corners to ${theme.shape.radiusMd}px`);
      }
      if (theme.shadow?.style) {
        parts.push(theme.shadow.style === "none" ? "removes shadows" : `adds ${theme.shadow.style} shadows`);
      }

      const components = Object.entries(theme.components ?? {}).map(([key, value]) => `${value} ${key}s`);
      if (components.length > 0) parts.push(`restyles ${components.join(", ")}`);

      const summary = parts.length > 0 ? parts.join(", ") : "leaves the theme unchanged";
      return `Restyles the CRM — ${summary}. Affects every screen, not the data.`;
    }

    case "reset_to_blank":
      return `Resets the workspace to a blank AI Studio canvas`;

    case "add_custom_agent":
      return `Adds a custom AI agent "${patch.agent.name}" with role "${patch.agent.role}" to the CRM`;

    case "remove_custom_agent": {
      const agent = before.customAgents?.find((a) => a.id === patch.agentId);
      return `Removes the custom agent "${agent?.name ?? patch.agentId}"`;
    }

    case "create_object":
      return `Adds a ${patch.object.labelPlural} object with ${patch.object.fields.length} ${
        patch.object.fields.length === 1 ? "field" : "fields"
      }`;

    case "delete_object": {
      const object = findObject(before, patch.objectKey);
      return `Removes the ${object?.labelPlural ?? patch.objectKey} object`;
    }

    case "update_object_label":
      return `Renames ${patch.objectKey} to "${patch.label ?? patch.labelPlural}"`;

    case "rollback":
      return `Restores the configuration as it was at version ${patch.toVersion}`;
  }
}

export function describeTrigger(automation: AutomationConfig, before: Config): string {
  const trigger = automation.trigger;
  const object = findObject(before, trigger.objectKey);
  const name = object?.label.toLowerCase() ?? trigger.objectKey;
  switch (trigger.type) {
    case "record_created":
      return `when a ${name} is created`;
    case "record_updated":
      return `when a ${name} is updated`;
    case "field_changed":
      return `when ${findField(before, trigger.fieldId)?.field.label ?? "a field"} changes on a ${name}`;
    case "date_reached":
      return `when a ${name} reaches its ${findField(before, trigger.fieldId)?.field.label ?? "date"}`;
    case "form_submitted":
      return `when a ${name} form is submitted`;
    case "webhook_received":
      return `when a webhook posts a ${name}`;
    case "schedule":
      return `${trigger.cadence}, for every ${name}`;
  }
}

/** One step, in a phrase. The plural of this is a workflow read out loud. */
export function describeStep(step: AutomationStep): string {
  switch (step.type) {
    case "set_field":
      return "sets a field";
    case "create_record":
      return `creates a ${step.objectKey}`;
    case "create_task":
      return `creates the task "${step.title}"`;
    case "send_email":
      return `sends an email to ${step.to}`;
    case "call_webhook":
      return `calls ${step.url}`;
    case "send_slack":
      return `posts to ${step.channel} in Slack`;
    case "send_sms":
      return `texts ${step.to}`;
    case "filter":
      return `continues only if ${plural(step.conditions.length, "a condition")} ${step.conditions.length === 1 ? "holds" : "hold"}`;
    case "delay":
      return `waits ${step.amount} ${plural(step.amount, step.unit.replace(/s$/, ""))}`;
    case "branch":
      return `branches ${step.paths.length} ${plural(step.paths.length, "way")}`;
  }
}

/** Kept for the pre-steps shape, which still reaches this from stored patches. */
export function describeAction(action: AutomationAction): string {
  return describeStep({ id: "", ...action } as AutomationStep);
}

function fieldTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    text: "text",
    long_text: "long text",
    number: "number",
    currency: "currency",
    date: "date",
    datetime: "date and time",
    boolean: "yes/no",
    select: "single choice",
    multi_select: "multiple choice",
    email: "email",
    phone: "phone",
    url: "link",
    relation: "link to another record",
    user: "person",
  };
  return labels[type] ?? type;
}

function rendererLabel(renderer: string): string {
  const labels: Record<string, string> = { table: "table", kanban: "board", detail: "detail view" };
  return labels[renderer] ?? renderer;
}

function list(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

/** What a generated screen is made of, in a phrase. Counts what the user sees. */
function summariseScreen(root: UiNode): string {
  const counts = new Map<string, number>();

  const walk = (node: UiNode): void => {
    if (["table", "board", "list", "chart", "metric", "form", "record_detail"].includes(node.kind)) {
      counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    }
    node.children?.forEach(walk);
  };
  walk(root);

  const names: Record<string, [string, string]> = {
    metric: ["metric", "metrics"],
    table: ["table", "tables"],
    board: ["board", "boards"],
    list: ["list", "lists"],
    chart: ["chart", "charts"],
    form: ["form", "forms"],
    record_detail: ["record panel", "record panels"],
  };

  return [...counts.entries()]
    .map(([kind, count]) => {
      const [one, many] = names[kind] ?? [kind, kind];
      return `${count} ${count === 1 ? one : many}`;
    })
    .join(", ");
}
