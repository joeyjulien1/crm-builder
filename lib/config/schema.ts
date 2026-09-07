import { z } from "zod";

/**
 * The config schema. Every TypeScript type for config is inferred from here —
 * see lib/config/types.ts. Nothing about config shape is hand-written twice.
 */

/* -------------------------------------------------------------------------- */
/* Fields                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Closed for v1. Adding a type is a four-file change: a FieldRenderer case, a
 * filter predicate, an import coercion, and a form input.
 */
export const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "currency",
  "date",
  "datetime",
  "boolean",
  "select",
  "multi_select",
  "email",
  "phone",
  "url",
  "relation",
  "user",
] as const;

export const fieldTypeSchema = z.enum(FIELD_TYPES);

export const RENDERERS = ["table", "kanban", "detail"] as const;
export const rendererSchema = z.enum(RENDERERS);

/**
 * The four objects a workspace starts with. They are the *starting* set, not
 * the permitted set.
 *
 * This was a closed enum, and it was the second reason every generated CRM felt
 * like the same product: a clinic could rename `contact` to "Patient" but could
 * not have Appointments, and a supermarket had to call its products
 * "companies". The data layer never needed the restriction —
 * `records.object_key` is plain text with no constraint, chosen deliberately in
 * docs/ARCHITECTURE.md so configuration drives the model without any DDL — so
 * opening it costs one regex and a referential check below, and no migration.
 *
 * Removal is still guarded: `delete_object` refuses while records exist, and
 * the four below are marked `system` on the objects that carry them.
 */
export const OBJECT_KEYS = ["contact", "company", "deal", "activity"] as const;

const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "must be lower_snake_case starting with a letter");

/** Any object this workspace has defined. Checked against the config, below. */
export const objectKeySchema = identifier;

const idSchema = z.string().min(1).max(64);

export const selectOptionSchema = z.object({
  value: identifier,
  label: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
});

export const fieldConfigSchema = z
  .object({
    id: idSchema,
    key: identifier,
    label: z.string().min(1).max(80),
    type: fieldTypeSchema,
    required: z.boolean().default(false),
    /** Fields the product depends on. The agent may relabel but not remove. */
    system: z.boolean().default(false),
    options: z.array(selectOptionSchema).optional(),
    default: z.unknown().optional(),
    currencyCode: z.string().length(3).optional(),
    /** For type: relation — which object the other end points at. */
    relationKey: identifier.optional(),
    helpText: z.string().max(200).optional(),
  })
  .superRefine((field, ctx) => {
    const needsOptions = field.type === "select" || field.type === "multi_select";
    if (needsOptions && (!field.options || field.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field.type} field "${field.label}" needs at least one option`,
        path: ["options"],
      });
    }
    if (!needsOptions && field.options) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `options are only valid on select and multi_select fields`,
        path: ["options"],
      });
    }
    if (field.type === "relation" && !field.relationKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `relation field "${field.label}" needs a relationKey`,
        path: ["relationKey"],
      });
    }
  });

/* -------------------------------------------------------------------------- */
/* Filters — a typed tree, one level of nesting. Never a query string.         */
/* -------------------------------------------------------------------------- */

export const OPERATORS = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "starts_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "in_last_days",
  "in_next_days",
  "is_any_of",
  "has_any_of",
  "has_all_of",
  "is_true",
  "is_false",
  "is_empty",
  "is_not_empty",
] as const;

export const operatorSchema = z.enum(OPERATORS);

/** Which operators a field type may be filtered with. */
export const OPERATORS_BY_TYPE: Record<
  (typeof FIELD_TYPES)[number],
  readonly (typeof OPERATORS)[number][]
> = {
  text: ["is", "is_not", "contains", "not_contains", "starts_with", "is_empty", "is_not_empty"],
  long_text: ["contains", "not_contains", "is_empty", "is_not_empty"],
  number: ["is", "is_not", "gt", "gte", "lt", "lte", "between", "is_empty", "is_not_empty"],
  currency: ["is", "is_not", "gt", "gte", "lt", "lte", "between", "is_empty", "is_not_empty"],
  date: ["is", "is_not", "gt", "lt", "between", "in_last_days", "in_next_days", "is_empty", "is_not_empty"],
  datetime: ["is", "is_not", "gt", "lt", "between", "in_last_days", "in_next_days", "is_empty", "is_not_empty"],
  boolean: ["is_true", "is_false"],
  select: ["is", "is_not", "is_any_of", "is_empty", "is_not_empty"],
  multi_select: ["has_any_of", "has_all_of", "is_empty", "is_not_empty"],
  email: ["is", "is_not", "contains", "starts_with", "is_empty", "is_not_empty"],
  phone: ["is", "is_not", "contains", "is_empty", "is_not_empty"],
  url: ["is", "is_not", "contains", "is_empty", "is_not_empty"],
  relation: ["is", "is_not", "is_any_of", "is_empty", "is_not_empty"],
  user: ["is", "is_not", "is_any_of", "is_empty", "is_not_empty"],
};

export const filterConditionSchema = z.object({
  fieldId: idSchema,
  operator: operatorSchema,
  value: z.unknown().optional(),
});

export const filterGroupSchema = z.object({
  join: z.enum(["and", "or"]),
  conditions: z.array(filterConditionSchema).max(20),
});

export const filterTreeSchema = z.object({
  join: z.enum(["and", "or"]),
  conditions: z.array(filterConditionSchema).max(20).default([]),
  /** The one permitted level of nesting. */
  groups: z.array(filterGroupSchema).max(5).default([]),
});

export const sortSchema = z.object({
  fieldId: idSchema,
  direction: z.enum(["asc", "desc"]),
});

/* -------------------------------------------------------------------------- */
/* Objects, views, pipelines                                                   */
/* -------------------------------------------------------------------------- */

export const layoutGroupSchema = z.object({
  label: z.string().min(1).max(60),
  fieldIds: z.array(idSchema),
});

export const layoutConfigSchema = z.object({
  groups: z.array(layoutGroupSchema).default([]),
});

export const objectConfigSchema = z.object({
  key: objectKeySchema,
  label: z.string().min(1).max(60),
  labelPlural: z.string().min(1).max(60),
  /** Order here is display order. reorder_fields rewrites it. */
  fields: z.array(fieldConfigSchema).max(200),
  layout: layoutConfigSchema.default({ groups: [] }),
  /** Which field to show as the record's title. */
  titleFieldId: idSchema.optional(),
});

export const viewConfigSchema = z.object({
  id: idSchema,
  objectKey: objectKeySchema,
  name: z.string().min(1).max(60),
  renderer: rendererSchema,
  columns: z.array(idSchema).max(60).default([]),
  filters: filterTreeSchema.optional(),
  sort: sortSchema.optional(),
  groupBy: idSchema.optional(),
  /** Required by the kanban renderer — its columns are the pipeline's stages. */
  pipelineId: idSchema.optional(),
});

export const pipelineStageSchema = z.object({
  key: identifier,
  label: z.string().min(1).max(60),
  probability: z.number().min(0).max(100).optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
});

export const pipelineConfigSchema = z.object({
  id: idSchema,
  objectKey: objectKeySchema,
  name: z.string().min(1).max(60),
  /** The select field whose value a card's column position writes. */
  stageFieldId: idSchema,
  stages: z.array(pipelineStageSchema).min(1).max(20),
});

export const relationConfigSchema = z.object({
  key: identifier,
  fromObject: objectKeySchema,
  toObject: objectKeySchema,
  kind: z.enum(["one_to_many", "many_to_many"]),
  label: z.string().min(1).max(60),
});

/* -------------------------------------------------------------------------- */
/* Automations                                                                 */
/* -------------------------------------------------------------------------- */

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("record_created"), objectKey: objectKeySchema }),
  z.object({ type: z.literal("record_updated"), objectKey: objectKeySchema }),
  z.object({ type: z.literal("field_changed"), objectKey: objectKeySchema, fieldId: idSchema }),
  z.object({
    type: z.literal("date_reached"),
    objectKey: objectKeySchema,
    fieldId: idSchema,
    offsetDays: z.number().int().min(-365).max(365).default(0),
  }),
  z.object({ type: z.literal("form_submitted"), objectKey: objectKeySchema }),
  /**
   * A POST from outside. The body's top-level keys are matched to this object's
   * field keys and become a record, which the steps then run against — so every
   * step still has "the record that triggered this" to work with.
   */
  z.object({ type: z.literal("webhook_received"), objectKey: objectKeySchema }),
  /**
   * On a cadence, once per matching record. There is no time of day here on
   * purpose: the sweep runs when the scheduler runs it, and a stored hour with
   * no workspace timezone behind it would be a half-truth.
   */
  z.object({
    type: z.literal("schedule"),
    objectKey: objectKeySchema,
    cadence: z.enum(["daily", "weekly", "monthly"]).default("daily"),
    /** 0 is Sunday. Weekly only. */
    weekday: z.number().int().min(0).max(6).optional(),
    /** Capped at 28 so every month has one. Monthly only. */
    dayOfMonth: z.number().int().min(1).max(28).optional(),
  }),
]);

/** send_email and call_webhook leave the building. They confirm separately. */
export const EXTERNAL_EFFECT_ACTIONS = ["send_email", "call_webhook", "send_slack", "send_sms"] as const;

/**
 * The five things a workflow can do to this workspace. Kept as its own union
 * because `update_automation` still accepts the pre-steps shape — see
 * `normalizeAutomation` below.
 */
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_field"), fieldId: idSchema, value: z.unknown() }),
  z.object({
    type: z.literal("create_record"),
    objectKey: objectKeySchema,
    values: z.record(z.unknown()).default({}),
  }),
  z.object({
    type: z.literal("create_task"),
    title: z.string().min(1).max(160),
    dueInDays: z.number().int().min(0).max(365).default(0),
  }),
  z.object({
    type: z.literal("send_email"),
    to: z.string().min(1).max(200),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
  }),
  z.object({
    type: z.literal("call_webhook"),
    url: z.string().url(),
    method: z.enum(["POST", "PUT"]).default("POST"),
    body: z.record(z.unknown()).optional(),
  }),
]);

/* -------------------------------------------------------------------------- */
/* Steps — an ordered program, not a flat list of actions                      */
/* -------------------------------------------------------------------------- */

/**
 * A workflow used to be `{ trigger, conditions[], actions[] }`: every condition
 * evaluated up front, every action run unconditionally after. That cannot say
 * "check this, then wait two days, then do one thing or the other", which is
 * most of what people actually automate.
 *
 * So a workflow is an ordered list of steps now, three of which control the run
 * rather than doing something to the workspace:
 *
 * - `filter` stops the run when its conditions do not hold.
 * - `delay` suspends it and resumes later, at the step after itself.
 * - `branch` runs the first path whose conditions hold, or `otherwise`.
 *
 * Branches nest, so this is recursive the way `uiNodeSchema` is, and capped for
 * the same reason: a workflow nobody can read is a workflow nobody trusts.
 */
export const STEP_TYPES = [
  "set_field",
  "create_record",
  "create_task",
  "send_email",
  "call_webhook",
  "send_slack",
  "send_sms",
  "filter",
  "delay",
  "branch",
] as const;

export type StepType = (typeof STEP_TYPES)[number];

export const DELAY_UNITS = ["minutes", "hours", "days"] as const;

const simpleStepSchemas = [
  z.object({ id: idSchema, type: z.literal("set_field"), fieldId: idSchema, value: z.unknown() }),
  z.object({
    id: idSchema,
    type: z.literal("create_record"),
    objectKey: objectKeySchema,
    values: z.record(z.unknown()).default({}),
  }),
  z.object({
    id: idSchema,
    type: z.literal("create_task"),
    title: z.string().min(1).max(160),
    dueInDays: z.number().int().min(0).max(365).default(0),
  }),
  z.object({
    id: idSchema,
    type: z.literal("send_email"),
    to: z.string().min(1).max(200),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
  }),
  z.object({
    id: idSchema,
    type: z.literal("call_webhook"),
    url: z.string().url(),
    method: z.enum(["POST", "PUT"]).default("POST"),
    body: z.record(z.unknown()).optional(),
  }),
  z.object({
    id: idSchema,
    type: z.literal("send_slack"),
    /** A channel name or id. The workspace's Slack connection decides where. */
    channel: z.string().min(1).max(80),
    text: z.string().min(1).max(3000),
  }),
  z.object({
    id: idSchema,
    type: z.literal("send_sms"),
    to: z.string().min(1).max(40),
    body: z.string().min(1).max(1600),
  }),
  z.object({
    id: idSchema,
    type: z.literal("filter"),
    conditions: z.array(filterConditionSchema).min(1).max(20),
  }),
  z.object({
    id: idSchema,
    type: z.literal("delay"),
    amount: z.number().int().min(1).max(365),
    unit: z.enum(DELAY_UNITS),
  }),
] as const;

type SimpleStep = z.output<(typeof simpleStepSchemas)[number]>;
type SimpleStepInput = z.input<(typeof simpleStepSchemas)[number]>;
type FilterConditionValue = z.output<typeof filterConditionSchema>;

export interface BranchPath {
  id: string;
  label: string;
  conditions: FilterConditionValue[];
  steps: AutomationStep[];
}

export interface BranchStep {
  id: string;
  type: "branch";
  paths: BranchPath[];
  otherwise?: AutomationStep[];
}

export type AutomationStep = SimpleStep | BranchStep;

interface BranchPathInput {
  id: string;
  label: string;
  conditions?: z.input<typeof filterConditionSchema>[];
  steps: AutomationStepInput[];
}

type AutomationStepInput =
  | SimpleStepInput
  | { id: string; type: "branch"; paths: BranchPathInput[]; otherwise?: AutomationStepInput[] };

/** Deep enough for "won or lost, and inside won, big or small". Not deeper. */
export const MAX_BRANCH_DEPTH = 3;

const branchPathSchema: z.ZodType<BranchPath, z.ZodTypeDef, BranchPathInput> = z.object({
  id: idSchema,
  label: z.string().min(1).max(60),
  conditions: z.array(filterConditionSchema).max(20).default([]),
  steps: z.lazy(() => z.array(automationStepSchema).max(25)),
});

export const automationStepSchema: z.ZodType<AutomationStep, z.ZodTypeDef, AutomationStepInput> =
  z.discriminatedUnion("type", [
    ...simpleStepSchemas,
    z.object({
      id: idSchema,
      type: z.literal("branch"),
      paths: z.array(branchPathSchema).min(1).max(5),
      otherwise: z.lazy(() => z.array(automationStepSchema).max(25)).optional(),
    }),
  ]) as unknown as z.ZodType<AutomationStep, z.ZodTypeDef, AutomationStepInput>;

/** Every step in a tree, in run order. Used by the caps here and by the editor. */
export function flattenSteps(steps: AutomationStep[]): AutomationStep[] {
  const flat: AutomationStep[] = [];
  const walk = (list: AutomationStep[]): void => {
    for (const step of list) {
      flat.push(step);
      if (step.type === "branch") {
        for (const path of step.paths) walk(path.steps);
        if (step.otherwise) walk(step.otherwise);
      }
    }
  };
  walk(steps);
  return flat;
}

function branchDepth(steps: AutomationStep[], depth = 1): number {
  let deepest = 0;
  for (const step of steps) {
    if (step.type !== "branch") continue;
    const nested = [...step.paths.flatMap((path) => path.steps), ...(step.otherwise ?? [])];
    deepest = Math.max(deepest, depth, branchDepth(nested, depth + 1));
  }
  return deepest;
}

/**
 * Reads either shape. Configs live in JSONB and are never re-parsed on read, so
 * a workspace saved before steps existed still arrives as `{conditions,
 * actions}` — here on the write path and in `hydrateConfig` on the read path.
 * Ids come from position, so normalising twice produces the same workflow.
 */
export function normalizeAutomation(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const automation = raw as Record<string, unknown>;
  if (Array.isArray(automation.steps)) return automation;
  if (!Array.isArray(automation.actions)) return automation;

  const conditions = Array.isArray(automation.conditions) ? automation.conditions : [];
  const steps: unknown[] = [];

  if (conditions.length > 0) {
    steps.push({ id: "step_filter", type: "filter", conditions });
  }
  automation.actions.forEach((action, index) => {
    if (!action || typeof action !== "object") return;
    steps.push({ id: `step_${index}`, ...(action as Record<string, unknown>) });
  });

  const rest = { ...automation };
  delete rest.conditions;
  delete rest.actions;
  return { ...rest, steps };
}

export const automationConfigSchema = z.preprocess(
  normalizeAutomation,
  z
    .object({
      id: idSchema,
      name: z.string().min(1).max(80),
      description: z.string().max(200).optional(),
      enabled: z.boolean().default(true),
      trigger: triggerSchema,
      steps: z.array(automationStepSchema).min(1).max(25),
    })
    .superRefine((automation, ctx) => {
      if (branchDepth(automation.steps) > MAX_BRANCH_DEPTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${automation.name}" nests branches more than ${MAX_BRANCH_DEPTH} deep. Split it into two workflows.`,
          path: ["steps"],
        });
      }

      const all = flattenSteps(automation.steps);
      if (all.length > 60) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${automation.name}" has ${all.length} steps, which is more than anyone can follow. Split it into two workflows.`,
          path: ["steps"],
        });
      }

      const ids = new Set<string>();
      for (const step of all) {
        if (ids.has(step.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `"${automation.name}" has two steps with the id ${step.id}`,
            path: ["steps"],
          });
        }
        ids.add(step.id);
      }
    }),
);

export const brandKpiSchema = z.object({
  label: z.string().max(40),
  value: z.string().max(40),
  change: z.string().max(40).optional(),
});

export const brandConfigSchema = z.object({
  name: z.string().max(80).default("CRM Studio"),
  tagline: z.string().max(160).optional(),
  logoText: z.string().max(6).default("C"),
  accentColor: z.string().default("#ffffff"),
  /** Upload id (files table) of the workspace logo image, if one was set. */
  logoFileId: z.string().uuid().nullable().optional(),
  theme: z.enum(["light", "dark", "monochrome"]).default("dark"),
  layoutStyle: z
    .enum(["clinic", "real_estate", "saas", "agency", "ecommerce", "legal", "fitness", "blank", "default"])
    .default("default"),
  kpis: z.array(brandKpiSchema).optional(),
});

/* -------------------------------------------------------------------------- */
/* Theme — the look of the CRM, as configuration rather than code.             */
/* -------------------------------------------------------------------------- */

/**
 * The look of the CRM, as values rather than as a menu.
 *
 * This was a closed set of four grey ramps and five radii, on the reasoning
 * that a tenant who can set every colour can make a CRM nobody can read. That
 * is true, and it produced a worse problem: every generated CRM looked
 * identical, because two workspaces differed in six scalars and the four ramps
 * were near-identical anyway.
 *
 * So the sets are open and the guarantee moved. Variety comes from generation —
 * the agent derives a palette for the customer — and safety comes from
 * validation: `assertReadable` in lib/config/theme.ts rejects a palette whose
 * text does not carry enough contrast against its own surface, the same way a
 * filter that can never be true is rejected rather than silently read zero.
 */
export const THEME_MODES = ["light", "dark"] as const;

const hexColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "must be a six-digit hex colour, like #4f63b5");

/** Every colour the interpreter can draw with. No component invents its own. */
export const themeColorsSchema = z.object({
  /** The page, the well behind it, raised things on it, and hover. */
  surface: hexColor.default("#101013"),
  sunken: hexColor.default("#0a0a0c"),
  raised: hexColor.default("#17171b"),
  hover: hexColor.default("#1f1f24"),

  textPrimary: hexColor.default("#f4f4f5"),
  textSecondary: hexColor.default("#a1a1a8"),
  textMuted: hexColor.default("#6c6c75"),

  borderSubtle: hexColor.default("#26262b"),
  borderStrong: hexColor.default("#3d3d44"),

  /** Buttons, links, focus, the active state of anything. */
  accent: hexColor.default("#4f63b5"),
  /** Text on top of the accent. Derived when the agent omits it. */
  accentFg: hexColor.optional(),

  danger: hexColor.default("#b4342f"),
  success: hexColor.default("#1d7a52"),
  warning: hexColor.default("#9a6510"),
});

/**
 * The body and display split is what lets a brokerage feel editorial and a
 * clinic feel clinical without either one being unreadable. Six real faces plus
 * three system stacks — enough range that two CRMs need not share a voice.
 */
export const THEME_FONTS = [
  /** System stacks: no download, and the safest fallback. */
  "system",
  "humanist",
  "slab",
  /** Loaded through next/font in app/layout.tsx. Self-hosted, no FOUT. */
  "inter",
  "sora",
  "spaceGrotesk",
  "fraunces",
  "lora",
  "mono",
] as const;

export const themeTypeSchema = z.object({
  fontBody: z.enum(THEME_FONTS).default("system"),
  /** Headings and metric values. Same as the body font unless set. */
  fontDisplay: z.enum(THEME_FONTS).optional(),
  /** Body size in px. Every other size is derived from it by the ratio. */
  baseSize: z.number().min(11).max(24).default(15),
  /** 1.125 is a dense tool; 1.414 is a magazine. */
  scaleRatio: z.number().min(1.05).max(1.7).default(1.2),
  lineHeight: z.number().min(1.1).max(2).default(1.45),
  /** Headings and labels. 400 to 900. */
  weightDisplay: z.number().int().min(300).max(900).default(600),
  weightBody: z.number().int().min(300).max(700).default(400),
  /** em. Negative tightens a display face; positive spaces out small caps. */
  tracking: z.number().min(-0.05).max(0.2).default(0),
  /** Small headings in capitals — an editorial choice, not a default. */
  uppercaseHeadings: z.boolean().default(false),
});

export const themeSpaceSchema = z.object({
  /** The base step in px. 2 is a dense terminal, 8 is airy. */
  unit: z.number().min(1).max(12).default(3),
  /** How fast the scale grows. 2 doubles at every step. */
  ratio: z.number().min(1.2).max(2.4).default(1.7),
  /** Row height for tables and lists, in px. */
  rowHeight: z.number().int().min(24).max(80).default(40),
  /** Height of inputs and buttons, in px. */
  controlHeight: z.number().int().min(24).max(64).default(38),
});

export const themeShapeSchema = z.object({
  radiusSm: z.number().min(0).max(32).default(4),
  radiusMd: z.number().min(0).max(48).default(6),
  radiusLg: z.number().min(0).max(9999).default(10),
  borderWidth: z.number().min(0).max(4).default(1),
  focusWidth: z.number().min(0).max(6).default(2),
  focusOffset: z.number().min(0).max(6).default(2),
});

/**
 * Structured rather than a CSS string: a preset plus its colour. Flat and
 * elevated are genuinely different products; arbitrary box-shadow syntax buys
 * nothing beyond that and cannot be edited in an inspector.
 */
export const SHADOW_STYLES = ["none", "hairline", "soft", "medium", "strong"] as const;

export const themeShadowSchema = z.object({
  style: z.enum(SHADOW_STYLES).default("none"),
  color: hexColor.default("#000000"),
  /** 0 to 1, applied to the shadow colour. */
  opacity: z.number().min(0).max(1).default(0.25),
});

export const THEME_EASINGS = ["linear", "standard", "decelerate", "spring"] as const;

export const themeMotionSchema = z.object({
  easing: z.enum(THEME_EASINGS).default("standard"),
  durationFast: z.number().int().min(0).max(600).default(120),
  duration: z.number().int().min(0).max(1200).default(180),
});

/**
 * How each component draws itself. This is what makes two CRMs feel like
 * different products rather than the same product repainted: a flush table on
 * tinted cards with pill buttons has no visual relationship to a bordered table
 * on outlined cards with square ones.
 */
export const TABLE_VARIANTS = ["bordered", "striped", "flush", "cards"] as const;
export const CARD_VARIANTS = ["outlined", "elevated", "flat", "tinted"] as const;
export const BUTTON_VARIANTS = ["solid", "outline", "ghost", "pill"] as const;
export const BADGE_VARIANTS = ["solid", "outline", "dot"] as const;
export const TABS_VARIANTS = ["underline", "pill", "segmented"] as const;
export const INPUT_VARIANTS = ["outlined", "filled", "underlined"] as const;

export const themeComponentsSchema = z.object({
  table: z.enum(TABLE_VARIANTS).default("bordered"),
  card: z.enum(CARD_VARIANTS).default("outlined"),
  button: z.enum(BUTTON_VARIANTS).default("solid"),
  badge: z.enum(BADGE_VARIANTS).default("outline"),
  tabs: z.enum(TABS_VARIANTS).default("underline"),
  input: z.enum(INPUT_VARIANTS).default("outlined"),
});

/**
 * What a patch may carry: every group optional, and partial within itself, so
 * changing one colour does not silently reset the other thirteen to defaults.
 */
export const themePatchSchema = z.object({
  mode: z.enum(THEME_MODES).optional(),
  colors: themeColorsSchema.partial().optional(),
  type: themeTypeSchema.partial().optional(),
  space: themeSpaceSchema.partial().optional(),
  shape: themeShapeSchema.partial().optional(),
  shadow: themeShadowSchema.partial().optional(),
  motion: themeMotionSchema.partial().optional(),
  components: themeComponentsSchema.partial().optional(),
});

export const themeConfigSchema = z.object({
  /** Drives Tailwind's dark: variant, and which way derived colours shift. */
  mode: z.enum(THEME_MODES).default("dark"),
  colors: themeColorsSchema.default({}),
  type: themeTypeSchema.default({}),
  space: themeSpaceSchema.default({}),
  shape: themeShapeSchema.default({}),
  shadow: themeShadowSchema.default({}),
  motion: themeMotionSchema.default({}),
  components: themeComponentsSchema.default({}),
});

export const customAgentConfigSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(80),
  role: z.string().min(1).max(80),
  description: z.string().max(200).default(""),
  instructions: z.string().max(4000).default(""),
  avatar: z.string().max(30).default("Bot"),
  enabled: z.boolean().default(true),
});

/* -------------------------------------------------------------------------- */
/* Screens — a composable tree, not a fixed set of screens.                    */
/* -------------------------------------------------------------------------- */

/**
 * The agent composes these the way it would compose HTML: freely, nested to any
 * useful depth, in whatever shape the business needs. There is no "table view"
 * or "kanban view" here — a board is a node you can put beside a form inside a
 * panel, and the agent decides what a screen is.
 *
 * The vocabulary is closed for the same reason HTML's is: an interpreter can
 * only draw what it knows, and every node has to bind to real records, stay
 * legible in any theme, and be reversible as a patch. Adding a kind is a real
 * change — a case in the interpreter — not a config edit.
 */
export const NODE_KINDS = [
  // Layout
  "stack",
  "grid",
  "card",
  "section",
  "panel",
  "tabs",
  "tab",
  "divider",
  "spacer",
  // Content
  "heading",
  "text",
  "metric",
  "badge",
  // Data, bound to real records
  "table",
  "board",
  "list",
  "chart",
  "form",
  "record_detail",
  // Interactive
  "button",
  "search",
  "filters",
] as const;

export const nodeKindSchema = z.enum(NODE_KINDS);

/**
 * Style is a token, never a value. The agent picks "lg" padding, not "23px", so
 * a generated screen inherits the tenant's theme instead of fighting it — and
 * every one of these is a control an inspector can render as a dropdown.
 *
 * Every node kind honours every prop that makes sense for it. A prop the
 * interpreter silently ignored would be a lie in the schema.
 */
export const uiStyleSchema = z.object({
  pad: z.enum(["none", "xs", "sm", "md", "lg", "xl"]).optional(),
  gap: z.enum(["none", "xs", "sm", "md", "lg", "xl"]).optional(),
  /** Cross-axis alignment. */
  align: z.enum(["start", "center", "end", "stretch", "baseline"]).optional(),
  /** Main-axis distribution. Was conflated with align. */
  justify: z.enum(["start", "center", "end", "between", "around"]).optional(),
  tone: z.enum(["default", "muted", "secondary", "accent", "success", "warning", "danger"]).optional(),
  size: z.enum(["xs", "sm", "md", "lg", "xl", "2xl"]).optional(),
  weight: z.enum(["normal", "medium", "semibold", "bold", "display"]).optional(),
  font: z.enum(["body", "display", "mono"]).optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  uppercase: z.boolean().optional(),
  /** Columns spanned inside a grid, out of the parent's `cols`. */
  span: z.number().int().min(1).max(12).optional(),
  border: z.boolean().optional(),
  radius: z.enum(["none", "sm", "md", "lg", "full"]).optional(),
  shadow: z.enum(["none", "card", "panel", "overlay"]).optional(),
  fill: z.enum(["none", "surface", "sunken", "raised", "accent", "accentSubtle"]).optional(),
  /** Fixed widths for panels and board columns, which used to be hardcoded. */
  width: z.enum(["auto", "full", "xs", "sm", "md", "lg", "xl"]).optional(),
  grow: z.boolean().optional(),
  scroll: z.boolean().optional(),
  /** Overrides the theme's component variant for this one node. */
  variant: z.string().max(20).optional(),
});

/** What a data node reads. Compiled by lib/runtime, never by the agent. */
export const uiQuerySchema = z.object({
  objectKey: objectKeySchema,
  filters: filterTreeSchema.optional(),
  sort: sortSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const AGGREGATES = ["count", "sum", "avg", "min", "max"] as const;

export const uiAggregateSchema = z.object({
  fn: z.enum(AGGREGATES),
  objectKey: objectKeySchema,
  /** Required for everything but count. */
  fieldId: idSchema.optional(),
  filters: filterTreeSchema.optional(),
});

export const uiActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("open_screen"), screenId: idSchema }),
  z.object({ type: z.literal("open_record"), recordId: idSchema.optional() }),
  z.object({ type: z.literal("create_record"), objectKey: objectKeySchema }),
  z.object({ type: z.literal("ask_agent"), prompt: z.string().max(300) }),
]);

const uiNodeBase = z.object({
  kind: nodeKindSchema,
  /**
   * Stable identity for the editor. Nodes are addressed by tree path when their
   * records are resolved, and a path stops meaning the same node the moment
   * something is reordered — so selection, and anything that has to survive a
   * drag, hangs off this instead. Optional: the agent need not mint one, and a
   * screen written before this existed is still valid.
   */
  id: idSchema.optional(),
  style: uiStyleSchema.optional(),

  /** Content nodes: the words on the screen. */
  text: z.string().max(400).optional(),
  label: z.string().max(120).optional(),

  /** Data nodes. */
  query: uiQuerySchema.optional(),
  aggregate: uiAggregateSchema.optional(),
  objectKey: objectKeySchema.optional(),
  columns: z.array(idSchema).max(30).optional(),
  fields: z.array(idSchema).max(60).optional(),
  fieldId: idSchema.optional(),
  pipelineId: idSchema.optional(),
  /** chart: what to plot along the x axis. */
  groupBy: idSchema.optional(),
  chartType: z.enum(["bar", "donut"]).optional(),

  /** Layout. */
  cols: z.number().int().min(1).max(12).optional(),
  direction: z.enum(["row", "column"]).optional(),
  side: z.enum(["left", "right"]).optional(),

  action: uiActionSchema.optional(),
});

/**
 * Recursion is the one place a config type is written by hand rather than
 * inferred — zod cannot infer a self-referencing shape. The hand-written half
 * is the `children` link and nothing else.
 */
export type UiNode = z.output<typeof uiNodeBase> & { children?: UiNode[] };

/**
 * Input and output differ — filters carry defaults — so both are named. Only
 * the `children` link is written by hand; every other field still comes from
 * the schema above.
 */
type UiNodeInput = z.input<typeof uiNodeBase> & { children?: UiNodeInput[] };

export const uiNodeSchema: z.ZodType<UiNode, z.ZodTypeDef, UiNodeInput> = uiNodeBase.extend({
  children: z.lazy(() => z.array(uiNodeSchema).max(40)).optional(),
});

/** Kinds that draw records, and therefore need something to read. */
const DATA_KINDS = new Set(["table", "board", "list", "chart"]);
const CONTAINER_KINDS = new Set(["stack", "grid", "card", "section", "panel", "tabs", "tab"]);

/** Deep enough for any real screen, shallow enough to render and to reason about. */
const MAX_DEPTH = 8;

/**
 * Two `is` conditions on one field, joined by and, can never both be true — the
 * metric silently reads 0 forever. It is the shape a model reaches for when it
 * means "not closed and not lost", and it is always a bug, so it is caught here
 * rather than left to be noticed on a dashboard six weeks later.
 */
function contradictoryFilters(filters: z.infer<typeof filterTreeSchema> | undefined): string | undefined {
  if (!filters || filters.join !== "and") return undefined;

  const byField = new Map<string, Set<unknown>>();
  for (const condition of filters.conditions ?? []) {
    if (condition.operator !== "is") continue;
    const seen = byField.get(condition.fieldId) ?? new Set();
    seen.add(JSON.stringify(condition.value));
    byField.set(condition.fieldId, seen);
  }

  for (const [fieldId, values] of byField) {
    if (values.size > 1) {
      return `${fieldId} cannot be two different values at once. Use is_not for "neither of these", or join: "or" for "either".`;
    }
  }
  return undefined;
}

/** One aggregate, flattened, so two metrics measuring the same thing collide. */
function aggregateKey(aggregate: NonNullable<UiNode["aggregate"]>): string {
  return JSON.stringify([aggregate.fn, aggregate.objectKey, aggregate.fieldId ?? null, aggregate.filters ?? null]);
}

function checkNode(
  node: UiNode,
  ctx: z.RefinementCtx,
  path: (string | number)[],
  depth: number,
  metrics?: Map<string, (string | number)[]>,
): void {
  if (depth > MAX_DEPTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `screens nest at most ${MAX_DEPTH} deep; flatten this layout`,
      path,
    });
    return;
  }

  if (DATA_KINDS.has(node.kind) && !node.query) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `a ${node.kind} needs a query saying which records it shows`,
      path,
    });
  }
  if (node.kind === "metric" && !node.aggregate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `a metric needs an aggregate, e.g. count of deals`,
      path,
    });
  }
  if (node.aggregate && node.aggregate.fn !== "count" && !node.aggregate.fieldId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${node.aggregate.fn} needs a fieldId to work on`,
      path,
    });
  }
  if (node.kind === "board" && !node.pipelineId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `a board needs a pipelineId for its columns`,
      path,
    });
  }
  if ((node.kind === "form" || node.kind === "record_detail") && !node.objectKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `a ${node.kind} needs an objectKey`,
      path,
    });
  }
  if (node.children && node.children.length > 0 && !CONTAINER_KINDS.has(node.kind)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `a ${node.kind} cannot contain other nodes`,
      path,
    });
  }

  const queryProblem = contradictoryFilters(node.query?.filters);
  if (queryProblem) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: queryProblem, path: [...path, "query", "filters"] });
  }

  const aggregateProblem = contradictoryFilters(node.aggregate?.filters);
  if (aggregateProblem) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: aggregateProblem, path: [...path, "aggregate", "filters"] });
  }

  // A screen showing the same number twice is a screen that looks informative
  // and is not. Cheap to detect, so it never ships.
  if (node.aggregate && metrics) {
    const key = aggregateKey(node.aggregate);
    const first = metrics.get(key);
    if (first) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `this metric counts exactly what "${first.join(".")}" already counts — give it its own filter, or drop it`,
        path: [...path, "aggregate"],
      });
    } else {
      metrics.set(key, [...path]);
    }
  }

  node.children?.forEach((child, index) =>
    checkNode(child, ctx, [...path, "children", index], depth + 1, metrics),
  );
}

/**
 * A screen's root, with the per-kind rules applied. Named separately because
 * update_screen replaces the tree on its own, and it has to be held to exactly
 * the same standard as one created from scratch.
 */
export const screenRootSchema = uiNodeSchema.superRefine((node, ctx) =>
  checkNode(node, ctx, [], 1, new Map()),
);

/**
 * A screen is written one of two ways.
 *
 * `root` is the composed tree above: a closed vocabulary an interpreter draws.
 * It is safe, editable in an inspector, and — measured against real output —
 * the reason two generated CRMs looked like the same product repainted. The
 * ceiling is the vocabulary, and the vocabulary is 22 kinds.
 *
 * `source` is a React component the agent wrote. There is no vocabulary and no
 * ceiling; the layout is whatever the screen needs. It is compiled in the
 * browser and evaluated against a fixed scope (`components/generated/scope.tsx`)
 * that hands it React, a UI kit, and a data client. It never runs on the server
 * and has no route to Postgres, so tenant isolation is exactly where it was —
 * in the database, enforced by RLS on queries the server builds.
 *
 * Exactly one of the two. Both shapes are stored in the same append-only
 * version row, so a generated screen is still diffable, revertible, and part of
 * the same history as everything else.
 */
export const SCREEN_SOURCE_MAX = 24_000;

export const screenConfigSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(60),
    /** Lucide icon name, for the nav. */
    icon: z.string().max(30).optional(),
    /** Order in the sidebar. */
    position: z.number().int().min(0).max(999).default(0),
    root: screenRootSchema.optional(),
    /** A React component, as source. See components/generated/. */
    source: z.string().max(SCREEN_SOURCE_MAX).optional(),
  })
  .superRefine((screen, ctx) => {
    if (!screen.root && !screen.source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `screen "${screen.name}" has neither a layout nor any code`,
        path: ["root"],
      });
    }
    if (screen.root && screen.source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `screen "${screen.name}" has both a composed layout and code; it can only have one`,
        path: ["source"],
      });
    }
    if (screen.source) {
      const banned = forbiddenInSource(screen.source);
      if (banned) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: banned, path: ["source"] });
      }
    }
  });

/**
 * What a generated screen may not contain.
 *
 * This is not the security boundary — the scope object is, and the code runs in
 * the browser with no server reach whatever it says. This is here to fail
 * *early and legibly*: a model reaching for `fetch` or `import` has
 * misunderstood the contract, and a validation error naming the line teaches it
 * faster than a blank screen at render time.
 */
export function forbiddenInSource(source: string): string | undefined {
  const rules: [RegExp, string][] = [
    [/\bimport\b/, "no imports — everything available is already in scope"],
    [/\brequire\b/, "no require — everything available is already in scope"],
    [/\bfetch\b/, "no fetch — read and write records through the data client in scope"],
    [/\bXMLHttpRequest\b/, "no XMLHttpRequest — use the data client in scope"],
    [/\beval\b/, "no eval"],
    [/\bFunction\b\s*\(/, "no Function constructor"],
    [/document\.cookie\b/, "no cookie access"],
    [/\b(localStorage|sessionStorage|indexedDB)\b/, "no browser storage — a screen is drawn from records, not from what the last visitor left behind"],
    [/\bwindow\.(location|open|parent|top)\b/, "no navigating or opening windows"],
  ];

  for (const [pattern, message] of rules) {
    if (pattern.test(source)) return message;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* The config                                                                  */
/* -------------------------------------------------------------------------- */

export const configSchema = z
  .object({
    schemaVersion: z.literal(1),
    brand: brandConfigSchema.optional().default({ name: "CRM Studio", logoText: "C", accentColor: "#ffffff" }),
    theme: themeConfigSchema.default({}),
    /** Generated screens. Composed by the agent, not chosen from a list. */
    screens: z.array(screenConfigSchema).max(40).default([]),
    customAgents: z.array(customAgentConfigSchema).default([]),
    objects: z.array(objectConfigSchema),
    views: z.array(viewConfigSchema).default([]),
    pipelines: z.array(pipelineConfigSchema).default([]),
    relations: z.array(relationConfigSchema).default([]),
    automations: z.array(automationConfigSchema).default([]),
  })
  .superRefine((config, ctx) => {
    const fieldIds = new Map<string, string>();
    for (const object of config.objects) {
      const keys = new Set<string>();
      for (const field of object.fields) {
        if (fieldIds.has(field.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate field id ${field.id}`,
            path: ["objects"],
          });
        }
        fieldIds.set(field.id, object.key);
        if (keys.has(field.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${object.label} already has a field keyed ${field.key}`,
            path: ["objects"],
          });
        }
        keys.add(field.key);
      }
    }

    const pipelineIds = new Set(config.pipelines.map((p) => p.id));

    for (const view of config.views) {
      for (const columnId of view.columns) {
        if (fieldIds.get(columnId) !== view.objectKey) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `view "${view.name}" references field ${columnId}, which is not on ${view.objectKey}`,
            path: ["views"],
          });
        }
      }
      if (view.renderer === "kanban") {
        if (!view.pipelineId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `kanban view "${view.name}" needs a pipeline`,
            path: ["views"],
          });
        } else if (!pipelineIds.has(view.pipelineId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `view "${view.name}" references pipeline ${view.pipelineId}, which does not exist`,
            path: ["views"],
          });
        }
      }
    }

    for (const pipeline of config.pipelines) {
      if (fieldIds.get(pipeline.stageFieldId) !== pipeline.objectKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `pipeline "${pipeline.name}" references stage field ${pipeline.stageFieldId}, which is not on ${pipeline.objectKey}`,
          path: ["pipelines"],
        });
      }
      const stageKeys = new Set<string>();
      for (const stage of pipeline.stages) {
        if (stageKeys.has(stage.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `pipeline "${pipeline.name}" has two stages keyed ${stage.key}`,
            path: ["pipelines"],
          });
        }
        stageKeys.add(stage.key);
      }
    }

    const relationKeys = new Set(config.relations.map((r) => r.key));
    for (const object of config.objects) {
      for (const field of object.fields) {
        if (field.type === "relation" && field.relationKey && !relationKeys.has(field.relationKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `field "${field.label}" references relation ${field.relationKey}, which does not exist`,
            path: ["objects"],
          });
        }
        if (field.type !== "boolean" && field.options) {
          const optionValues = new Set<string>();
          for (const option of field.options) {
            if (optionValues.has(option.value)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `field "${field.label}" has two options valued ${option.value}`,
                path: ["objects"],
              });
            }
            optionValues.add(option.value);
          }
        }
      }
    }

    const objectKeys = new Set(config.objects.map((object) => object.key));

    const mustExist = (objectKey: string, where: string, path: string): void => {
      if (!objectKeys.has(objectKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${where} refers to ${objectKey}, which is not an object in this workspace`,
          path: [path],
        });
      }
    };

    for (const object of config.objects) {
      if (config.objects.filter((candidate) => candidate.key === object.key).length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `there are two objects keyed ${object.key}`,
          path: ["objects"],
        });
      }
    }

    for (const view of config.views) mustExist(view.objectKey, `view "${view.name}"`, "views");
    for (const pipeline of config.pipelines) {
      mustExist(pipeline.objectKey, `pipeline "${pipeline.name}"`, "pipelines");
    }
    for (const relation of config.relations) {
      mustExist(relation.fromObject, `relation "${relation.label}"`, "relations");
      mustExist(relation.toObject, `relation "${relation.label}"`, "relations");
    }
    for (const automation of config.automations) {
      mustExist(automation.trigger.objectKey, `automation "${automation.name}"`, "automations");
    }
  });
