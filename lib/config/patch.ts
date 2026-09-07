import { z } from "zod";
import {
  actionSchema,
  automationConfigSchema,
  automationStepSchema,
  brandConfigSchema,
  configSchema,
  customAgentConfigSchema,
  fieldConfigSchema,
  filterConditionSchema,
  flattenSteps,
  normalizeAutomation,
  filterTreeSchema,
  objectConfigSchema,
  objectKeySchema,
  pipelineConfigSchema,
  pipelineStageSchema,
  relationConfigSchema,
  selectOptionSchema,
  screenConfigSchema,
  screenRootSchema,
  SCREEN_SOURCE_MAX,
  sortSchema,
  themePatchSchema,
  triggerSchema,
  viewConfigSchema,
} from "./schema";
import type { AutomationConfig, Config, ConfigPatch, FieldConfig, ObjectConfig } from "./types";

const idSchema = z.string().min(1).max(64);

/**
 * One patch variant per tool in docs/AGENT-TOOLS.md, plus rollback. A tool's
 * arguments and its patch are not the same shape: ids are minted when the tool
 * runs and travel in the patch.
 *
 * Changing a field's type is deliberately absent. It is a data migration.
 */
export const configPatchSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_field"), objectKey: objectKeySchema, field: fieldConfigSchema }),
  z.object({
    op: z.literal("update_field"),
    fieldId: idSchema,
    label: z.string().min(1).max(80).optional(),
    options: z.array(selectOptionSchema).optional(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    helpText: z.string().max(200).optional(),
  }),
  z.object({ op: z.literal("remove_field"), fieldId: idSchema }),
  z.object({ op: z.literal("create_relation"), relation: relationConfigSchema }),
  z.object({
    op: z.literal("reorder_fields"),
    objectKey: objectKeySchema,
    fieldIds: z.array(idSchema),
  }),

  z.object({ op: z.literal("create_view"), view: viewConfigSchema }),
  z.object({
    op: z.literal("update_view"),
    viewId: idSchema,
    name: z.string().min(1).max(60).optional(),
    columns: z.array(idSchema).optional(),
    filters: filterTreeSchema.nullish(),
    sort: sortSchema.nullish(),
    groupBy: idSchema.nullish(),
  }),
  z.object({ op: z.literal("delete_view"), viewId: idSchema }),

  z.object({ op: z.literal("create_pipeline"), pipeline: pipelineConfigSchema }),
  z.object({
    op: z.literal("update_pipeline"),
    pipelineId: idSchema,
    name: z.string().min(1).max(60).optional(),
    stages: z.array(pipelineStageSchema).min(1).max(20).optional(),
    /** Required for every stage the patch removes: where its records go. */
    stageMigrations: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  }),

  z.object({ op: z.literal("create_automation"), automation: automationConfigSchema }),
  z.object({
    op: z.literal("update_automation"),
    automationId: idSchema,
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(200).optional(),
    trigger: triggerSchema.optional(),
    /** The whole program, replaced — a workflow is edited by sending it back. */
    steps: z.array(automationStepSchema).min(1).max(25).optional(),
    /** The pre-steps shape, still accepted so old patches replay. */
    conditions: z.array(filterConditionSchema).optional(),
    actions: z.array(actionSchema).min(1).max(10).optional(),
  }),
  z.object({
    op: z.literal("set_automation_enabled"),
    automationId: idSchema,
    enabled: z.boolean(),
  }),

  z.object({
    op: z.literal("update_brand"),
    brand: z.object({
      name: z.string().max(80).optional(),
      tagline: z.string().max(160).optional(),
      logoText: z.string().max(6).optional(),
      accentColor: z.string().optional(),
      logoFileId: z.string().uuid().nullable().optional(),
      theme: z.enum(["light", "dark", "monochrome"]).optional(),
      layoutStyle: z
        .enum(["clinic", "real_estate", "saas", "agency", "ecommerce", "legal", "fitness", "blank", "default"])
        .optional(),
      kpis: z
        .array(
          z.object({
            label: z.string(),
            value: z.string(),
            change: z.string().optional(),
          }),
        )
        .optional(),
    }),
  }),
  z.object({ op: z.literal("create_screen"), screen: screenConfigSchema }),
  z.object({
    op: z.literal("update_screen"),
    screenId: idSchema,
    name: z.string().min(1).max(60).optional(),
    icon: z.string().max(30).optional(),
    position: z.number().int().min(0).max(999).optional(),
    /** Replaces the whole tree — a composed screen is edited by regenerating it. */
    root: screenRootSchema.optional(),
    /** Replaces the whole component — same rule, for a coded screen. */
    source: z.string().max(SCREEN_SOURCE_MAX).optional(),
  }),
  z.object({ op: z.literal("delete_screen"), screenId: idSchema }),
  z.object({
    op: z.literal("update_theme"),
    /** Deep partial: only what the user asked to change moves. */
    theme: themePatchSchema,
  }),
  z.object({
    op: z.literal("reset_to_blank"),
    /** The config to start from, supplied by the caller. See rollback. */
    config: configSchema,
  }),
  z.object({
    op: z.literal("add_custom_agent"),
    agent: customAgentConfigSchema,
  }),
  z.object({
    op: z.literal("remove_custom_agent"),
    agentId: idSchema,
  }),
  z.object({ op: z.literal("create_object"), object: objectConfigSchema }),
  z.object({ op: z.literal("delete_object"), objectKey: objectKeySchema }),
  z.object({
    op: z.literal("update_object_label"),
    objectKey: objectKeySchema,
    label: z.string().min(1).max(80).optional(),
    labelPlural: z.string().min(1).max(80).optional(),
  }),

  /** Rollback carries the whole config it restores — see docs/ARCHITECTURE.md. */
  z.object({
    op: z.literal("rollback"),
    toVersion: z.number().int().positive(),
    config: configSchema,
  }),
]);

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

export function findObject(config: Config, objectKey: string): ObjectConfig | undefined {
  return config.objects.find((o) => o.key === objectKey);
}

export function findField(
  config: Config,
  fieldId: string,
): { object: ObjectConfig; field: FieldConfig } | undefined {
  for (const object of config.objects) {
    const field = object.fields.find((f) => f.id === fieldId);
    if (field) return { object, field };
  }
  return undefined;
}

function requireObject(config: Config, objectKey: string): ObjectConfig {
  const object = findObject(config, objectKey);
  if (!object) throw new PatchError(`There is no ${objectKey} object`);
  return object;
}

function requireField(config: Config, fieldId: string): { object: ObjectConfig; field: FieldConfig } {
  const found = findField(config, fieldId);
  if (!found) throw new PatchError(`There is no field ${fieldId}`);
  return found;
}

/** Keeps a pipeline's stages and its stage field's options from drifting apart. */
function syncStageOptions(config: Config, pipelineId: string): void {
  const pipeline = config.pipelines.find((p) => p.id === pipelineId);
  if (!pipeline) return;
  const found = findField(config, pipeline.stageFieldId);
  if (!found) return;
  found.field.options = pipeline.stages.map((stage) => ({
    value: stage.key,
    label: stage.label,
  }));
}

/**
 * Whether a workflow reads or writes this field anywhere — its trigger, any
 * filter, any branch's conditions, or a set_field step at any depth. Removing a
 * field a workflow depends on would leave a run that silently does nothing, so
 * the patch refuses instead. The editor asks this before offering delete.
 */
export function automationUsesField(automation: AutomationConfig, fieldId: string): boolean {
  const trigger = automation.trigger;
  if ((trigger.type === "field_changed" || trigger.type === "date_reached") && trigger.fieldId === fieldId) {
    return true;
  }

  return flattenSteps(automation.steps).some((step) => {
    if (step.type === "set_field") return step.fieldId === fieldId;
    if (step.type === "filter") return step.conditions.some((c) => c.fieldId === fieldId);
    if (step.type === "branch") {
      return step.paths.some((path) => path.conditions.some((c) => c.fieldId === fieldId));
    }
    return false;
  });
}

/* -------------------------------------------------------------------------- */
/* Apply                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Applies one patch to a config and returns a new config. Pure: the input is
 * never mutated. Throws PatchError when the patch does not make sense against
 * this config — the agent sees that message and retries once.
 */
export function applyPatch(config: Config, patch: ConfigPatch): Config {
  const next: Config = structuredClone(config);

  switch (patch.op) {
    case "add_field": {
      const object = requireObject(next, patch.objectKey);
      if (object.fields.some((f) => f.key === patch.field.key)) {
        throw new PatchError(`${object.label} already has a field called ${patch.field.label}`);
      }
      if (findField(next, patch.field.id)) {
        throw new PatchError(`Field id ${patch.field.id} is already in use`);
      }
      object.fields.push(patch.field);
      break;
    }

    case "update_field": {
      const { field } = requireField(next, patch.fieldId);
      if (patch.label !== undefined) field.label = patch.label;
      if (patch.required !== undefined) field.required = patch.required;
      if (patch.helpText !== undefined) field.helpText = patch.helpText;
      if (patch.default !== undefined) field.default = patch.default;
      if (patch.options !== undefined) {
        if (field.type !== "select" && field.type !== "multi_select") {
          throw new PatchError(`${field.label} is not a choice field, so it has no options`);
        }
        field.options = patch.options;
      }
      break;
    }

    case "remove_field": {
      const { object, field } = requireField(next, patch.fieldId);
      if (field.system) {
        throw new PatchError(`${field.label} is a built-in field and cannot be removed`);
      }

      const pipeline = next.pipelines.find((p) => p.stageFieldId === field.id);
      if (pipeline) {
        throw new PatchError(
          `${field.label} holds the stages for the ${pipeline.name} pipeline. Remove the pipeline first.`,
        );
      }

      const automation = next.automations.find((a) => automationUsesField(a, field.id));
      if (automation) {
        throw new PatchError(
          `${field.label} is used by the "${automation.name}" automation. Update that automation first.`,
        );
      }

      object.fields = object.fields.filter((f) => f.id !== field.id);
      object.layout.groups = object.layout.groups.map((group) => ({
        ...group,
        fieldIds: group.fieldIds.filter((id) => id !== field.id),
      }));
      if (object.titleFieldId === field.id) object.titleFieldId = undefined;

      for (const view of next.views) {
        view.columns = view.columns.filter((id) => id !== field.id);
        if (view.sort?.fieldId === field.id) view.sort = undefined;
        if (view.groupBy === field.id) view.groupBy = undefined;
        if (view.filters) {
          view.filters.conditions = view.filters.conditions.filter((c) => c.fieldId !== field.id);
          view.filters.groups = view.filters.groups
            .map((group) => ({
              ...group,
              conditions: group.conditions.filter((c) => c.fieldId !== field.id),
            }))
            .filter((group) => group.conditions.length > 0);
        }
      }
      break;
    }

    case "create_relation": {
      if (next.relations.some((r) => r.key === patch.relation.key)) {
        throw new PatchError(`A relation called ${patch.relation.key} already exists`);
      }
      requireObject(next, patch.relation.fromObject);
      requireObject(next, patch.relation.toObject);
      next.relations.push(patch.relation);
      break;
    }

    case "reorder_fields": {
      const object = requireObject(next, patch.objectKey);
      const current = object.fields.map((f) => f.id).sort();
      const proposed = [...patch.fieldIds].sort();
      if (
        current.length !== proposed.length ||
        current.some((id, index) => id !== proposed[index])
      ) {
        throw new PatchError(`Reordering ${object.labelPlural} must list every field exactly once`);
      }
      const byId = new Map(object.fields.map((f) => [f.id, f]));
      object.fields = patch.fieldIds.map((id) => byId.get(id)!);
      break;
    }

    case "create_view": {
      if (next.views.some((v) => v.id === patch.view.id)) {
        throw new PatchError(`View id ${patch.view.id} is already in use`);
      }
      requireObject(next, patch.view.objectKey);
      next.views.push(patch.view);
      break;
    }

    case "update_view": {
      const view = next.views.find((v) => v.id === patch.viewId);
      if (!view) throw new PatchError(`There is no view ${patch.viewId}`);
      if (patch.name !== undefined) view.name = patch.name;
      if (patch.columns !== undefined) view.columns = patch.columns;
      if (patch.filters !== undefined) view.filters = patch.filters ?? undefined;
      if (patch.sort !== undefined) view.sort = patch.sort ?? undefined;
      if (patch.groupBy !== undefined) view.groupBy = patch.groupBy ?? undefined;
      break;
    }

    case "delete_view": {
      if (!next.views.some((v) => v.id === patch.viewId)) {
        throw new PatchError(`There is no view ${patch.viewId}`);
      }
      next.views = next.views.filter((v) => v.id !== patch.viewId);
      break;
    }

    case "create_pipeline": {
      if (next.pipelines.some((p) => p.id === patch.pipeline.id)) {
        throw new PatchError(`Pipeline id ${patch.pipeline.id} is already in use`);
      }
      const { field } = requireField(next, patch.pipeline.stageFieldId);
      if (field.type !== "select") {
        throw new PatchError(`A pipeline's stage field must be a choice field, and ${field.label} is not`);
      }
      next.pipelines.push(patch.pipeline);
      syncStageOptions(next, patch.pipeline.id);
      break;
    }

    case "update_pipeline": {
      const pipeline = next.pipelines.find((p) => p.id === patch.pipelineId);
      if (!pipeline) throw new PatchError(`There is no pipeline ${patch.pipelineId}`);
      if (patch.name !== undefined) pipeline.name = patch.name;

      if (patch.stages) {
        const nextKeys = new Set(patch.stages.map((s) => s.key));
        const removed = pipeline.stages.filter((s) => !nextKeys.has(s.key));
        const migrations = new Map((patch.stageMigrations ?? []).map((m) => [m.from, m.to]));

        for (const stage of removed) {
          const target = migrations.get(stage.key);
          if (!target) {
            throw new PatchError(
              `Removing the ${stage.label} stage needs somewhere for its records to go`,
            );
          }
          if (!nextKeys.has(target)) {
            throw new PatchError(
              `The ${stage.label} stage cannot move records to ${target}, which is not a stage in this pipeline`,
            );
          }
        }
        pipeline.stages = patch.stages;
        syncStageOptions(next, pipeline.id);
      }
      break;
    }

    case "create_automation": {
      if (next.automations.some((a) => a.id === patch.automation.id)) {
        throw new PatchError(`Automation id ${patch.automation.id} is already in use`);
      }
      next.automations.push(patch.automation);
      break;
    }

    case "update_automation": {
      const automation = next.automations.find((a) => a.id === patch.automationId);
      if (!automation) throw new PatchError(`There is no automation ${patch.automationId}`);
      if (patch.name !== undefined) automation.name = patch.name;
      if (patch.description !== undefined) automation.description = patch.description;
      if (patch.trigger !== undefined) automation.trigger = patch.trigger;
      if (patch.steps !== undefined) {
        automation.steps = patch.steps;
      } else if (patch.conditions !== undefined || patch.actions !== undefined) {
        // A patch in the pre-steps shape, replayed from history or written by
        // an older client. Reshape it rather than refusing it.
        const reshaped = normalizeAutomation({
          ...automation,
          conditions: patch.conditions ?? [],
          actions: patch.actions ?? [],
          steps: undefined,
        }) as AutomationConfig;
        automation.steps = reshaped.steps;
      }
      break;
    }

    case "set_automation_enabled": {
      const automation = next.automations.find((a) => a.id === patch.automationId);
      if (!automation) throw new PatchError(`There is no automation ${patch.automationId}`);
      automation.enabled = patch.enabled;
      break;
    }

    case "update_brand": {
      next.brand = {
        name: patch.brand.name ?? next.brand?.name ?? "CRM Studio",
        tagline: patch.brand.tagline ?? next.brand?.tagline,
        logoText: patch.brand.logoText ?? next.brand?.logoText ?? "C",
        accentColor: patch.brand.accentColor ?? next.brand?.accentColor ?? "#ffffff",
        logoFileId: patch.brand.logoFileId !== undefined ? patch.brand.logoFileId : next.brand?.logoFileId,
        theme: patch.brand.theme ?? next.brand?.theme ?? "dark",
        layoutStyle: patch.brand.layoutStyle ?? next.brand?.layoutStyle ?? "default",
        kpis: patch.brand.kpis ?? next.brand?.kpis,
      };
      break;
    }

    case "create_screen": {
      if (next.screens.some((screen) => screen.id === patch.screen.id)) {
        throw new PatchError(`Screen id ${patch.screen.id} is already in use`);
      }
      if (next.screens.some((screen) => screen.name === patch.screen.name)) {
        throw new PatchError(`A screen called "${patch.screen.name}" already exists`);
      }
      next.screens.push(patch.screen);
      break;
    }

    case "update_screen": {
      const screen = next.screens.find((candidate) => candidate.id === patch.screenId);
      if (!screen) throw new PatchError(`There is no screen ${patch.screenId}`);
      if (patch.name !== undefined) screen.name = patch.name;
      if (patch.icon !== undefined) screen.icon = patch.icon;
      if (patch.position !== undefined) screen.position = patch.position;
      if (patch.root !== undefined) {
        screen.root = patch.root;
        delete screen.source;
      }
      if (patch.source !== undefined) {
        screen.source = patch.source;
        delete screen.root;
      }
      break;
    }

    case "delete_screen": {
      if (!next.screens.some((screen) => screen.id === patch.screenId)) {
        throw new PatchError(`There is no screen ${patch.screenId}`);
      }
      next.screens = next.screens.filter((screen) => screen.id !== patch.screenId);
      break;
    }

    case "update_theme": {
      // Merged one level down, not replaced: asking for a teal accent must not
      // reset the typography, and setting one colour must not reset the other
      // thirteen. Anything absent from the patch keeps the value it had.
      const current = next.theme ?? ({} as Config["theme"]);
      next.theme = {
        ...current,
        ...(patch.theme.mode !== undefined ? { mode: patch.theme.mode } : {}),
        colors: { ...current.colors, ...patch.theme.colors },
        type: { ...current.type, ...patch.theme.type },
        space: { ...current.space, ...patch.theme.space },
        shape: { ...current.shape, ...patch.theme.shape },
        shadow: { ...current.shadow, ...patch.theme.shadow },
        motion: { ...current.motion, ...patch.theme.motion },
        components: { ...current.components, ...patch.theme.components },
      } as Config["theme"];
      break;
    }

    case "reset_to_blank": {
      // A new project is new. This used to clear only views and automations,
      // which left the renamed objects, every custom field, the pipelines,
      // relations, screens, assistants and the theme of the previous CRM in
      // place — so "start over" handed you the old workspace with its screens
      // hidden. It carries a whole config now, like rollback does.
      const fresh = structuredClone(patch.config);
      fresh.brand = {
        ...fresh.brand,
        name: fresh.brand?.name ?? "New project",
        logoText: fresh.brand?.logoText ?? "N",
        accentColor: fresh.brand?.accentColor ?? "#ffffff",
        theme: fresh.brand?.theme ?? "dark",
        layoutStyle: "blank",
        kpis: [],
      };
      return fresh;
    }

    case "add_custom_agent": {
      if (!next.customAgents) next.customAgents = [];
      if (next.customAgents.some((a) => a.id === patch.agent.id)) {
        throw new PatchError(`Agent id ${patch.agent.id} is already in use`);
      }
      next.customAgents.push(patch.agent);
      break;
    }

    case "remove_custom_agent": {
      if (!next.customAgents) next.customAgents = [];
      next.customAgents = next.customAgents.filter((a) => a.id !== patch.agentId);
      break;
    }

    case "create_object": {
      if (next.objects.some((object) => object.key === patch.object.key)) {
        throw new PatchError(`This workspace already has an object keyed ${patch.object.key}`);
      }
      next.objects.push(patch.object);
      break;
    }

    case "delete_object": {
      const object = requireObject(next, patch.objectKey);

      // Everything that points at an object has to go first, and saying which
      // beats a validation error about a dangling key three layers down.
      const view = next.views.find((candidate) => candidate.objectKey === object.key);
      if (view) throw new PatchError(`The "${view.name}" view reads ${object.labelPlural}. Delete it first.`);

      const pipeline = next.pipelines.find((candidate) => candidate.objectKey === object.key);
      if (pipeline) {
        throw new PatchError(`The ${pipeline.name} pipeline is on ${object.labelPlural}. Remove it first.`);
      }

      const automation = next.automations.find(
        (candidate) => candidate.trigger.objectKey === object.key,
      );
      if (automation) {
        throw new PatchError(
          `The "${automation.name}" workflow runs on ${object.labelPlural}. Change or delete it first.`,
        );
      }

      const relation = next.relations.find(
        (candidate) => candidate.fromObject === object.key || candidate.toObject === object.key,
      );
      if (relation) {
        throw new PatchError(`${object.labelPlural} is linked by "${relation.label}". Remove that link first.`);
      }

      next.objects = next.objects.filter((candidate) => candidate.key !== object.key);
      break;
    }

    case "update_object_label": {
      const obj = requireObject(next, patch.objectKey);
      if (patch.label) obj.label = patch.label;
      if (patch.labelPlural) obj.labelPlural = patch.labelPlural;
      break;
    }

    case "rollback":
      return structuredClone(patch.config);
  }

  return next;
}

/**
 * Applies a turn's worth of patches as a set. Either the whole set validates
 * and produces one new config, or nothing is applied.
 */
export function applyPatches(config: Config, patches: ConfigPatch[]): Config {
  let next = config;
  for (const patch of patches) next = applyPatch(next, patch);
  return validateConfig(next);
}

export function validateConfig(config: unknown): Config {
  const result = configSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => i.message).join("; ");
    throw new PatchError(issues);
  }
  return result.data;
}

export function parsePatch(input: unknown): ConfigPatch {
  const result = configPatchSchema.safeParse(input);
  if (!result.success) {
    throw new PatchError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return result.data;
}
