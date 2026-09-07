import {
  AGGREGATES,
  BADGE_VARIANTS,
  BUTTON_VARIANTS,
  CARD_VARIANTS,
  FIELD_TYPES,
  INPUT_VARIANTS,
  OPERATORS_BY_TYPE,
  TABLE_VARIANTS,
  TABS_VARIANTS,
} from "./schema";
import type { FieldType, UiNode } from "./types";

/**
 * What the backend editor's inspector draws, declared once.
 *
 * Shopify's theme editor works because a section declares its settings and the
 * editor renders inputs from that declaration — the merchant never sees the
 * schema, and nobody hand-writes a panel per section. This is the same idea
 * against this repo's zod schemas: every editable thing names its controls here
 * and `Inspector` renders them. Adding a node kind adds a case in `nodeControls`,
 * not a new component.
 *
 * Two rules keep it honest:
 *
 * - **Option lists are derived, never retyped.** They come off the same const
 *   arrays the zod enums are built from, so a control cannot offer a value that
 *   validation would reject.
 * - **A control edits a path, not a field.** `key` is a dot path into the thing
 *   being edited ("style.pad", "query.objectKey"), which is what lets one
 *   inspector edit a screen node, a field, and a workflow step.
 */

export interface ControlOption {
  value: string;
  label: string;
}

interface ControlBase {
  /** Dot path into the edited object, e.g. "style.pad". */
  key: string;
  label: string;
  help?: string;
}

/**
 * Where a control finds the object whose fields it should offer: either a dot
 * path to an object key on the edited thing, or "$trigger" — the workflow's own
 * trigger object, which is what every step in that workflow operates on.
 */
export type ObjectSource = string;

export const TRIGGER_OBJECT: ObjectSource = "$trigger";

export type Control =
  | (ControlBase & { kind: "text"; placeholder?: string; max?: number })
  | (ControlBase & { kind: "textarea"; rows?: number; max?: number })
  | (ControlBase & { kind: "merge-text"; rows?: number; max?: number; objectFrom: ObjectSource })
  | (ControlBase & { kind: "number"; min?: number; max?: number; step?: number; unit?: string })
  | (ControlBase & { kind: "toggle" })
  | (ControlBase & {
      kind: "select";
      options: ControlOption[];
      clearable?: boolean;
      /** The option values are numbers in the config, strings in the DOM. */
      numeric?: boolean;
    })
  | (ControlBase & { kind: "object" })
  | (ControlBase & {
      kind: "field";
      objectFrom: ObjectSource;
      types?: readonly FieldType[];
      clearable?: boolean;
    })
  | (ControlBase & { kind: "fields"; objectFrom: ObjectSource })
  | (ControlBase & { kind: "filters"; objectFrom: ObjectSource })
  | (ControlBase & { kind: "conditions"; objectFrom: ObjectSource })
  | (ControlBase & { kind: "options" })
  | (ControlBase & { kind: "pipeline" })
  | (ControlBase & { kind: "screen" })
  | (ControlBase & { kind: "sort"; objectFrom: ObjectSource })
  | (ControlBase & { kind: "values"; objectFrom: ObjectSource });

export interface ControlGroup {
  label: string;
  controls: Control[];
  /** Groups start collapsed when they are secondary to the thing's purpose. */
  collapsed?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Reading and writing by path                                                 */
/* -------------------------------------------------------------------------- */

type Bag = Record<string, unknown>;

export function readAt(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const step of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Bag)[step];
  }
  return current;
}

/**
 * Returns a copy with `path` set. Pure — the inspector holds a draft and commits
 * it as one patch, so nothing here may mutate the config it was handed. Writing
 * `undefined` deletes the key rather than leaving a hole in the JSON.
 */
export function writeAt<T>(source: T, path: string, value: unknown): T {
  const steps = path.split(".");
  const clone = structuredClone(source) as Bag;

  let current = clone;
  for (const step of steps.slice(0, -1)) {
    const next = current[step];
    if (next === null || next === undefined || typeof next !== "object") current[step] = {};
    current = current[step] as Bag;
  }

  const last = steps[steps.length - 1]!;
  if (value === undefined) delete current[last];
  else current[last] = value;

  return clone as T;
}

/* -------------------------------------------------------------------------- */
/* Option lists, derived from the schema's own constants                       */
/* -------------------------------------------------------------------------- */

/** "multi_select" -> "Multi select". Config keys are lower_snake_case throughout. */
function sentence(value: string): string {
  const spaced = value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function options(values: readonly string[], labels: Record<string, string> = {}): ControlOption[] {
  return values.map((value) => ({ value, label: labels[value] ?? sentence(value) }));
}

export const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  currency: "Currency",
  date: "Date",
  datetime: "Date and time",
  boolean: "Yes or no",
  select: "Single choice",
  multi_select: "Multiple choice",
  relation: "Related record",
  user: "User",
  email: "Email",
  phone: "Phone",
  url: "URL",
};

export const OPERATOR_LABELS: Record<string, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  between: "is between",
  in_last_days: "is in the last (days)",
  in_next_days: "is in the next (days)",
  is_any_of: "is any of",
  has_any_of: "has any of",
  has_all_of: "has all of",
  is_true: "is true",
  is_false: "is false",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

export const FIELD_TYPE_OPTIONS = options(FIELD_TYPES, FIELD_TYPE_LABELS);

/** Which operators a field may be compared with — the schema's own table. */
export function operatorOptions(type: FieldType | undefined): ControlOption[] {
  const allowed = type ? OPERATORS_BY_TYPE[type] : undefined;
  return options(allowed ?? Object.keys(OPERATOR_LABELS), OPERATOR_LABELS);
}

/** Operators that take no value, so the inspector hides the value input. */
export const VALUELESS_OPERATORS = new Set(["is_true", "is_false", "is_empty", "is_not_empty"]);

const SPACING = options(["none", "xs", "sm", "md", "lg", "xl"]);
const SIZES = options(["xs", "sm", "md", "lg", "xl", "2xl"]);

/* -------------------------------------------------------------------------- */
/* Screen nodes                                                                */
/* -------------------------------------------------------------------------- */

const QUERY_OBJECT: ObjectSource = "query.objectKey";

function queryGroup(label = "Data"): ControlGroup {
  return {
    label,
    controls: [
      { kind: "object", key: "query.objectKey", label: "Records", help: "Which object this reads." },
      { kind: "filters", key: "query.filters", label: "Filters", objectFrom: QUERY_OBJECT },
      { kind: "sort", key: "query.sort", label: "Sort", objectFrom: QUERY_OBJECT },
      { kind: "number", key: "query.limit", label: "Limit", min: 1, max: 500, unit: "rows" },
    ],
  };
}

function aggregateGroup(): ControlGroup {
  return {
    label: "Measure",
    controls: [
      {
        kind: "select",
        key: "aggregate.fn",
        label: "Function",
        options: options(AGGREGATES, { avg: "Average", min: "Minimum", max: "Maximum" }),
      },
      { kind: "object", key: "aggregate.objectKey", label: "Records" },
      {
        kind: "field",
        key: "aggregate.fieldId",
        label: "Field",
        objectFrom: "aggregate.objectKey",
        types: ["number", "currency"],
        clearable: true,
        help: "Required for everything but count.",
      },
      { kind: "filters", key: "aggregate.filters", label: "Filters", objectFrom: "aggregate.objectKey" },
    ],
  };
}

/** Layout props, shown for the kinds that lay other things out. */
const LAYOUT_GROUP: ControlGroup = {
  label: "Layout",
  collapsed: true,
  controls: [
    { kind: "select", key: "style.pad", label: "Padding", options: SPACING, clearable: true },
    { kind: "select", key: "style.gap", label: "Gap", options: SPACING, clearable: true },
    {
      kind: "select",
      key: "style.align",
      label: "Align",
      options: options(["start", "center", "end", "stretch", "baseline"]),
      clearable: true,
    },
    {
      kind: "select",
      key: "style.justify",
      label: "Distribute",
      options: options(["start", "center", "end", "between", "around"]),
      clearable: true,
    },
    {
      kind: "select",
      key: "style.width",
      label: "Width",
      options: options(["auto", "full", "xs", "sm", "md", "lg", "xl"]),
      clearable: true,
    },
    { kind: "number", key: "style.span", label: "Columns spanned", min: 1, max: 12 },
    { kind: "toggle", key: "style.grow", label: "Fill remaining space" },
    { kind: "toggle", key: "style.scroll", label: "Scroll when it overflows" },
  ],
};

/** Appearance props. Every kind honours these. */
function appearanceGroup(variants?: readonly string[]): ControlGroup {
  return {
    label: "Appearance",
    collapsed: true,
    controls: [
      {
        kind: "select",
        key: "style.tone",
        label: "Tone",
        options: options(["default", "muted", "secondary", "accent", "success", "warning", "danger"]),
        clearable: true,
      },
      { kind: "select", key: "style.size", label: "Size", options: SIZES, clearable: true },
      {
        kind: "select",
        key: "style.weight",
        label: "Weight",
        options: options(["normal", "medium", "semibold", "bold", "display"]),
        clearable: true,
      },
      {
        kind: "select",
        key: "style.font",
        label: "Typeface",
        options: options(["body", "display", "mono"]),
        clearable: true,
      },
      {
        kind: "select",
        key: "style.textAlign",
        label: "Text align",
        options: options(["left", "center", "right"]),
        clearable: true,
      },
      { kind: "toggle", key: "style.uppercase", label: "Capitals" },
      { kind: "toggle", key: "style.border", label: "Border" },
      {
        kind: "select",
        key: "style.radius",
        label: "Corners",
        options: options(["none", "sm", "md", "lg", "full"]),
        clearable: true,
      },
      {
        kind: "select",
        key: "style.shadow",
        label: "Shadow",
        options: options(["none", "card", "panel", "overlay"]),
        clearable: true,
      },
      {
        kind: "select",
        key: "style.fill",
        label: "Background",
        options: options(["none", "surface", "sunken", "raised", "accent", "accentSubtle"], {
          accentSubtle: "Accent, subtle",
        }),
        clearable: true,
      },
      ...(variants
        ? [
            {
              kind: "select" as const,
              key: "style.variant",
              label: "Variant",
              options: options(variants),
              clearable: true,
              help: "Overrides the theme's variant for this one node.",
            },
          ]
        : []),
    ],
  };
}

const TEXT_CONTROL: Control = { kind: "textarea", key: "text", label: "Text", rows: 3, max: 400 };
const LABEL_CONTROL: Control = { kind: "text", key: "label", label: "Label", max: 120 };

/** Kinds that hold other nodes. The tree offers "add inside" only for these. */
export const CONTAINER_KINDS = new Set<UiNode["kind"]>([
  "stack",
  "grid",
  "card",
  "section",
  "panel",
  "tabs",
  "tab",
]);

/** What the inspector shows for one screen node. */
export function nodeControls(kind: UiNode["kind"]): ControlGroup[] {
  const content = (controls: Control[], label = "Content"): ControlGroup[] =>
    controls.length ? [{ label, controls }] : [];

  switch (kind) {
    case "stack":
      return [
        ...content(
          [
            LABEL_CONTROL,
            { kind: "select", key: "direction", label: "Direction", options: options(["column", "row"]) },
          ],
          "Stack",
        ),
        LAYOUT_GROUP,
        appearanceGroup(),
      ];

    case "grid":
      return [
        ...content([{ kind: "number", key: "cols", label: "Columns", min: 1, max: 12 }], "Grid"),
        LAYOUT_GROUP,
        appearanceGroup(),
      ];

    case "card":
      return [...content([LABEL_CONTROL]), LAYOUT_GROUP, appearanceGroup(CARD_VARIANTS)];

    case "section":
    case "tab":
      return [...content([LABEL_CONTROL]), LAYOUT_GROUP, appearanceGroup()];

    case "tabs":
      return [LAYOUT_GROUP, appearanceGroup(TABS_VARIANTS)];

    case "panel":
      return [
        ...content([
          LABEL_CONTROL,
          { kind: "select", key: "side", label: "Side", options: options(["left", "right"]) },
        ]),
        LAYOUT_GROUP,
        appearanceGroup(),
      ];

    case "divider":
    case "spacer":
      return [LAYOUT_GROUP, appearanceGroup()];

    case "heading":
    case "text":
      return [...content([TEXT_CONTROL]), appearanceGroup()];

    case "badge":
      return [...content([TEXT_CONTROL]), appearanceGroup(BADGE_VARIANTS)];

    case "metric":
      return [...content([LABEL_CONTROL]), aggregateGroup(), appearanceGroup()];

    case "table":
      return [
        ...content([LABEL_CONTROL]),
        queryGroup(),
        {
          label: "Columns",
          controls: [{ kind: "fields", key: "columns", label: "Columns", objectFrom: QUERY_OBJECT }],
        },
        LAYOUT_GROUP,
        appearanceGroup(TABLE_VARIANTS),
      ];

    case "board":
      return [
        ...content([LABEL_CONTROL]),
        queryGroup(),
        { label: "Columns", controls: [{ kind: "pipeline", key: "pipelineId", label: "Pipeline" }] },
        LAYOUT_GROUP,
        appearanceGroup(CARD_VARIANTS),
      ];

    case "list":
      return [
        ...content([LABEL_CONTROL]),
        queryGroup(),
        {
          label: "Columns",
          controls: [{ kind: "fields", key: "columns", label: "Shown fields", objectFrom: QUERY_OBJECT }],
        },
        LAYOUT_GROUP,
        appearanceGroup(),
      ];

    case "chart":
      return [
        ...content([LABEL_CONTROL]),
        queryGroup(),
        {
          label: "Plot",
          controls: [
            { kind: "field", key: "groupBy", label: "Group by", objectFrom: QUERY_OBJECT },
            { kind: "select", key: "chartType", label: "Chart", options: options(["bar", "donut"]) },
          ],
        },
        LAYOUT_GROUP,
        appearanceGroup(),
      ];

    case "form":
    case "record_detail":
      return [
        ...content([
          LABEL_CONTROL,
          { kind: "object", key: "objectKey", label: "Object" },
          { kind: "fields", key: "fields", label: "Fields", objectFrom: "objectKey" },
        ]),
        LAYOUT_GROUP,
        appearanceGroup(kind === "form" ? INPUT_VARIANTS : CARD_VARIANTS),
      ];

    case "search":
    case "filters":
      return [
        ...content([{ kind: "text", key: "label", label: "Placeholder", max: 120 }]),
        appearanceGroup(INPUT_VARIANTS),
      ];

    case "button":
      return [
        ...content([
          LABEL_CONTROL,
          {
            kind: "select",
            key: "action.type",
            label: "On click",
            options: options(["open_screen", "open_record", "create_record", "ask_agent"], {
              open_screen: "Open a screen",
              open_record: "Open a record",
              create_record: "Add a record",
              ask_agent: "Ask the agent",
            }),
          },
          { kind: "screen", key: "action.screenId", label: "Screen" },
          { kind: "object", key: "action.objectKey", label: "Object" },
          { kind: "textarea", key: "action.prompt", label: "Prompt", rows: 2, max: 300 },
        ]),
        appearanceGroup(BUTTON_VARIANTS),
      ];
  }
}

/**
 * Whether a control applies to the draft as it currently stands. The inspector
 * hides the rest rather than offering a screen picker on a button that creates a
 * record, or a field picker on a metric that counts rows.
 */
export function controlApplies(control: Control, draft: unknown): boolean {
  const actionType = readAt(draft, "action.type");
  if (control.key === "action.screenId") return actionType === "open_screen";
  if (control.key === "action.objectKey") return actionType === "create_record";
  if (control.key === "action.prompt") return actionType === "ask_agent";

  if (control.key === "aggregate.fieldId") {
    const fn = readAt(draft, "aggregate.fn");
    return fn !== undefined && fn !== "count";
  }

  const cadence = readAt(draft, "cadence");
  if (control.key === "weekday") return cadence === "weekly";
  if (control.key === "dayOfMonth") return cadence === "monthly";

  return true;
}

/* -------------------------------------------------------------------------- */
/* Fields                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A field's editable settings. Type is absent on purpose: changing a field's
 * type is a data migration, not a config edit, and there is deliberately no
 * patch op for it — see docs/AGENT-TOOLS.md.
 */
export function fieldControls(type: FieldType): ControlGroup[] {
  const groups: ControlGroup[] = [
    {
      label: "Field",
      controls: [
        { kind: "text", key: "label", label: "Name", max: 80 },
        { kind: "toggle", key: "required", label: "Required" },
        { kind: "text", key: "helpText", label: "Help text", max: 200, help: "Shown under the input." },
      ],
    },
  ];

  if (type === "select" || type === "multi_select") {
    groups.push({ label: "Choices", controls: [{ kind: "options", key: "options", label: "Options" }] });
  }

  return groups;
}

/* -------------------------------------------------------------------------- */
/* Workflows                                                                   */
/* -------------------------------------------------------------------------- */

const TRIGGER_LABELS: Record<string, string> = {
  record_created: "A record is created",
  record_updated: "A record is updated",
  field_changed: "A field changes",
  date_reached: "A date is reached",
  form_submitted: "A form is submitted",
  webhook_received: "A webhook posts to us",
  schedule: "On a schedule",
};

export const TRIGGER_OPTIONS = options(Object.keys(TRIGGER_LABELS), TRIGGER_LABELS);

/** The trigger card's settings. Every workflow has exactly one of these. */
export function triggerControls(type: string): ControlGroup[] {
  const controls: Control[] = [
    { kind: "select", key: "type", label: "When", options: TRIGGER_OPTIONS },
    { kind: "object", key: "objectKey", label: "On", help: "Which records this watches." },
  ];

  if (type === "field_changed" || type === "date_reached") {
    controls.push({
      kind: "field",
      key: "fieldId",
      label: "Field",
      objectFrom: "objectKey",
      types: type === "date_reached" ? (["date", "datetime"] as const) : undefined,
    });
  }

  if (type === "date_reached") {
    controls.push({
      kind: "number",
      key: "offsetDays",
      label: "Offset",
      min: -365,
      max: 365,
      unit: "days",
      help: "Negative runs before the date, positive after.",
    });
  }

  if (type === "schedule") {
    controls.push({
      kind: "select",
      key: "cadence",
      label: "How often",
      options: options(["daily", "weekly", "monthly"]),
      help: "Runs once per matching record, when the daily sweep runs.",
    });
    controls.push({
      kind: "select",
      key: "weekday",
      label: "Day of the week",
      numeric: true,
      options: [
        { value: "1", label: "Monday" },
        { value: "2", label: "Tuesday" },
        { value: "3", label: "Wednesday" },
        { value: "4", label: "Thursday" },
        { value: "5", label: "Friday" },
        { value: "6", label: "Saturday" },
        { value: "0", label: "Sunday" },
      ],
    });
    controls.push({ kind: "number", key: "dayOfMonth", label: "Day of the month", min: 1, max: 28 });
  }

  return [{ label: "Trigger", controls }];
}

export const STEP_LABELS: Record<string, string> = {
  filter: "Only continue if",
  delay: "Wait",
  branch: "Branch",
  set_field: "Update a field",
  create_record: "Create a record",
  create_task: "Create a task",
  send_email: "Send an email",
  send_slack: "Post to Slack",
  send_sms: "Send a text",
  call_webhook: "Call a webhook",
};

export const STEP_BLURBS: Record<string, string> = {
  filter: "Stop the run unless these conditions hold.",
  delay: "Pause, then carry on with the rest.",
  branch: "Take one path or another, depending on the record.",
  set_field: "Write a value onto the record that triggered this.",
  create_record: "Add a record to any object.",
  create_task: "Put a task on the activity timeline.",
  send_email: "Send through the mailbox this workspace has connected.",
  send_slack: "Post a message to a channel in the connected Slack workspace.",
  send_sms: "Text a number through the connected Twilio account.",
  call_webhook: "POST to a URL you control.",
};

/**
 * A step's settings. Every step operates on the workflow's trigger object, so
 * its field pickers read `$trigger` rather than a path on the step itself.
 */
export function stepControls(type: string): ControlGroup[] {
  switch (type) {
    case "filter":
      return [
        {
          label: "Conditions",
          controls: [{ kind: "conditions", key: "conditions", label: "Continue only if", objectFrom: TRIGGER_OBJECT }],
        },
      ];

    case "delay":
      return [
        {
          label: "Wait",
          controls: [
            { kind: "number", key: "amount", label: "How long", min: 1, max: 365 },
            {
              kind: "select",
              key: "unit",
              label: "Unit",
              options: options(["minutes", "hours", "days"]),
            },
          ],
        },
      ];

    case "set_field":
      return [
        {
          label: "Update",
          controls: [
            { kind: "field", key: "fieldId", label: "Field", objectFrom: TRIGGER_OBJECT },
            { kind: "merge-text", key: "value", label: "New value", rows: 2, objectFrom: TRIGGER_OBJECT },
          ],
        },
      ];

    case "create_record":
      return [
        {
          label: "Create",
          controls: [
            { kind: "object", key: "objectKey", label: "Object" },
            { kind: "values", key: "values", label: "Set on creation", objectFrom: "objectKey" },
          ],
        },
      ];

    case "create_task":
      return [
        {
          label: "Task",
          controls: [
            { kind: "merge-text", key: "title", label: "Title", rows: 2, max: 160, objectFrom: TRIGGER_OBJECT },
            { kind: "number", key: "dueInDays", label: "Due in", min: 0, max: 365, unit: "days" },
          ],
        },
      ];

    case "send_email":
      return [
        {
          label: "Email",
          controls: [
            { kind: "merge-text", key: "to", label: "To", rows: 1, max: 200, objectFrom: TRIGGER_OBJECT },
            { kind: "merge-text", key: "subject", label: "Subject", rows: 1, max: 200, objectFrom: TRIGGER_OBJECT },
            { kind: "merge-text", key: "body", label: "Body", rows: 8, max: 5000, objectFrom: TRIGGER_OBJECT },
          ],
        },
      ];

    case "send_slack":
      return [
        {
          label: "Slack",
          controls: [
            {
              kind: "text",
              key: "channel",
              label: "Channel",
              max: 80,
              placeholder: "#sales",
              help: "A channel name or id. The bot has to be in it.",
            },
            { kind: "merge-text", key: "text", label: "Message", rows: 5, max: 3000, objectFrom: TRIGGER_OBJECT },
          ],
        },
      ];

    case "send_sms":
      return [
        {
          label: "Text message",
          controls: [
            { kind: "merge-text", key: "to", label: "To", rows: 1, max: 40, objectFrom: TRIGGER_OBJECT },
            { kind: "merge-text", key: "body", label: "Message", rows: 5, max: 1600, objectFrom: TRIGGER_OBJECT },
          ],
        },
      ];

    case "call_webhook":
      return [
        {
          label: "Webhook",
          controls: [
            { kind: "text", key: "url", label: "URL", placeholder: "https://" },
            {
              kind: "select",
              key: "method",
              label: "Method",
              options: options(["POST", "PUT"], { POST: "POST", PUT: "PUT" }),
            },
          ],
        },
      ];

    case "branch":
      // A branch's paths are edited on the card itself, where the nesting is
      // visible. A form cannot show "this path, then those steps" legibly.
      return [];

    default:
      return [];
  }
}
