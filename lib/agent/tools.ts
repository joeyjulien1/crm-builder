import type Anthropic from "@anthropic-ai/sdk";
import { randomBytes } from "node:crypto";
import {
  BADGE_VARIANTS,
  BUTTON_VARIANTS,
  CARD_VARIANTS,
  FIELD_TYPES,
  INPUT_VARIANTS,
  OBJECT_KEYS,
  RENDERERS,
  SHADOW_STYLES,
  TABLE_VARIANTS,
  TABS_VARIANTS,
  THEME_EASINGS,
  THEME_FONTS,
  THEME_MODES,
} from "@/lib/config/schema";
import { assertReadable, resolveTheme } from "@/lib/config/theme";
import { findField, findObject, parsePatch } from "@/lib/config/patch";
import { checkScreenSource } from "@/lib/config/screen-source";
import { startingConfig } from "@/lib/config/default";
import type { Config, ConfigPatch } from "@/lib/config/types";

/**
 * The agent's entire surface. If it isn't here, the agent cannot do it.
 *
 * Every mutating tool returns a patch, never a result. Patches accumulate
 * across a turn, validate as a set, render as one diff, and apply as one
 * config version on confirmation. Read tools return data — and note what is
 * absent: nothing reads record contents. The agent knows a tenant has 1,847
 * deals; it does not know who they are with.
 */

export const FIELD_TYPE_LIST = [...FIELD_TYPES];

function id(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

/**
 * Every step needs an id, and asking the model to invent unique ones is asking
 * for a collision. Mint them here instead, leaving any the model did supply —
 * an update that sends a step back unchanged keeps its identity, which is what
 * the editor's selection and a delayed run's resume cursor both rely on.
 */
function withStepIds(input: unknown): unknown[] {
  if (!Array.isArray(input)) return [];

  return input.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const step = entry as Record<string, unknown>;
    const withId = { ...step, id: typeof step.id === "string" && step.id ? step.id : id("stp") };

    if (step.type !== "branch") return withId;

    return {
      ...withId,
      paths: Array.isArray(step.paths)
        ? step.paths.map((path) => {
            const branch = (path ?? {}) as Record<string, unknown>;
            return {
              ...branch,
              id: typeof branch.id === "string" && branch.id ? branch.id : id("pth"),
              steps: withStepIds(branch.steps),
            };
          })
        : [],
      ...(step.otherwise !== undefined ? { otherwise: withStepIds(step.otherwise) } : {}),
    };
  });
}

function keyFrom(label: string, taken: Set<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^([0-9])/, "f$1") || "field";

  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

function optionsFrom(raw: unknown): { value: string; label: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const taken = new Set<string>();
  return raw.map((entry) => {
    const label = typeof entry === "string" ? entry : String((entry as { label?: string }).label ?? entry);
    const value = keyFrom(label, taken);
    taken.add(value);
    return { value, label };
  });
}

export interface ToolContext {
  config: Config;
  counts: Record<string, number>;
  /** Import tools hand back a proposal rather than a config patch. */
  onImportProposal?: (proposal: ImportProposal) => void;
  sampleImportFile?: (fileId: string) => Promise<{ headers: string[]; rows: string[][] }>;
  /**
   * Resolves a user upload by id for tools that reference files (brand
   * logo). Null when the id is missing or belongs to another tenant.
   */
  resolveUploadFile?: (
    fileId: string,
  ) => Promise<{ id: string; filename: string; mimeType: string; kind: string } | null>;
  /** Which third-party accounts this user has connected, and their labels. */
  connections?: { provider: string; label: string; connected: boolean; account?: string }[];
  /** Asks the UI to offer a connection. Never performs one. */
  onConnectRequest?: (request: ConnectRequest) => void;
  /** The agent's own checklist for this turn, shown in the panel as it works. */
  onPlan?: (steps: PlanStep[]) => void;
  /** Follow-ups the agent offers as buttons under its reply. */
  onSuggestions?: (suggestions: string[]) => void;
}

export interface PlanStep {
  text: string;
  status: "pending" | "active" | "done";
}

export interface ConnectRequest {
  provider: string;
  label: string;
  /** Why this account is needed, in the user's terms. */
  reason: string;
}

export interface ImportProposal {
  fileId: string;
  objectKey: string;
  mapping: Record<string, string>;
  dedupeKey?: string;
  unmapped: string[];
}

export interface ToolOutcome {
  /** Staged config changes. Empty for read tools. */
  patches: ConfigPatch[];
  /** What the model is told happened. */
  message: string;
  isError?: boolean;
}

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_connections",
    description:
      "List the third-party accounts this user has connected, and which are available to connect. Check this before attempting anything that needs one.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "request_connection",
    description:
      "Ask the user to connect a third-party account, when a task needs one they have not connected. This offers a button in the conversation; it does not connect anything itself. Say plainly why the account is needed.",
    input_schema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Provider key, as returned by list_connections." },
        reason: {
          type: "string",
          description: "Why this account is needed, in the user's terms, in one sentence.",
        },
      },
      required: ["provider", "reason"],
    },
  },
  {
    name: "get_config",
    description: "Read the tenant's current resolved configuration.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_schema_summary",
    description:
      "List objects, their fields and types, and how many records each object holds. Use this before proposing a change.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "add_field",
    description: "Add a field to an object.",
    input_schema: {
      type: "object",
      properties: {
        object_key: { type: "string", enum: [...OBJECT_KEYS] },
        label: { type: "string", description: "What the user calls it, e.g. 'Renewal date'." },
        type: { type: "string", enum: FIELD_TYPE_LIST },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Choice labels. Required for select and multi_select.",
        },
        required: { type: "boolean" },
        default: { description: "Default value for new records." },
      },
      required: ["object_key", "label", "type"],
      additionalProperties: false,
    },
  },
  {
    name: "update_field",
    description:
      "Change a field's label, options, requiredness, or default. A field's type cannot be changed — that is a data migration. Propose a new field and offer to backfill instead.",
    input_schema: {
      type: "object",
      properties: {
        field_id: { type: "string" },
        label: { type: "string" },
        options: { type: "array", items: { type: "string" } },
        required: { type: "boolean" },
        default: {},
      },
      required: ["field_id"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_field",
    description:
      "Remove a field. Destructive: the patch carries how many records hold a value. Ask the user before proposing this.",
    input_schema: {
      type: "object",
      properties: { field_id: { type: "string" } },
      required: ["field_id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_relation",
    description: "Link two objects together.",
    input_schema: {
      type: "object",
      properties: {
        from_object: { type: "string", enum: [...OBJECT_KEYS] },
        to_object: { type: "string", enum: [...OBJECT_KEYS] },
        kind: { type: "string", enum: ["one_to_many", "many_to_many"] },
        label: { type: "string" },
      },
      required: ["from_object", "to_object", "kind", "label"],
      additionalProperties: false,
    },
  },
  {
    name: "reorder_fields",
    description: "Set the display order of an object's fields. Must list every field exactly once.",
    input_schema: {
      type: "object",
      properties: {
        object_key: { type: "string", enum: [...OBJECT_KEYS] },
        field_ids: { type: "array", items: { type: "string" } },
      },
      required: ["object_key", "field_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "create_view",
    description: "Create a view of an object.",
    input_schema: {
      type: "object",
      properties: {
        object_key: { type: "string", enum: [...OBJECT_KEYS] },
        name: { type: "string" },
        renderer: { type: "string", enum: [...RENDERERS] },
        columns: { type: "array", items: { type: "string" }, description: "Field ids, in order." },
        filters: { type: "object", description: "A filter tree: join, conditions, groups." },
        sort: { type: "object", description: "{ fieldId, direction }" },
        group_by: { type: "string" },
        pipeline_id: { type: "string", description: "Required when renderer is kanban." },
      },
      required: ["object_key", "name", "renderer", "columns"],
      additionalProperties: false,
    },
  },
  {
    name: "update_view",
    description: "Change a view's name, columns, filters, sort, or grouping.",
    input_schema: {
      type: "object",
      properties: {
        view_id: { type: "string" },
        name: { type: "string" },
        columns: { type: "array", items: { type: "string" } },
        filters: { type: "object" },
        sort: { type: "object" },
        group_by: { type: "string" },
      },
      required: ["view_id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_view",
    description: "Delete a view. Destructive.",
    input_schema: {
      type: "object",
      properties: { view_id: { type: "string" } },
      required: ["view_id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_pipeline",
    description: "Create a pipeline. Its stages become the columns of a board.",
    input_schema: {
      type: "object",
      properties: {
        object_key: { type: "string", enum: [...OBJECT_KEYS] },
        name: { type: "string" },
        stage_field_id: { type: "string", description: "An existing single-choice field." },
        stages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              probability: { type: "number" },
              is_won: { type: "boolean" },
              is_lost: { type: "boolean" },
            },
            required: ["label"],
          },
        },
      },
      required: ["object_key", "name", "stage_field_id", "stages"],
      additionalProperties: false,
    },
  },
  {
    name: "update_pipeline",
    description:
      "Change a pipeline's name or stages. Removing a stage that holds records requires stage_migrations saying where those records go — ask the user rather than choosing for them.",
    input_schema: {
      type: "object",
      properties: {
        pipeline_id: { type: "string" },
        name: { type: "string" },
        stages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Keep the existing key to keep the stage." },
              label: { type: "string" },
              probability: { type: "number" },
              is_won: { type: "boolean" },
              is_lost: { type: "boolean" },
            },
            required: ["label"],
          },
        },
        stage_migrations: {
          type: "array",
          items: {
            type: "object",
            properties: { from: { type: "string" }, to: { type: "string" } },
            required: ["from", "to"],
          },
        },
      },
      required: ["pipeline_id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_automation",
    description:
      "Create a workflow: a trigger, then an ordered list of steps.\n\nTriggers: record_created, record_updated, field_changed, date_reached, form_submitted, webhook_received (an outside system posts a record in), and schedule ({ cadence: daily|weekly|monthly, weekday?, dayOfMonth? }), which runs once per matching record.\n\nSteps run in order. Seven of them do something — set_field, create_record, create_task, send_email, send_slack ({ channel, text }), send_sms ({ to, body }), call_webhook — and three control the run:\n- filter: { type: 'filter', conditions: [...] } stops the run unless the conditions hold. Use this instead of conditions on the workflow itself.\n- delay: { type: 'delay', amount: 2, unit: 'days' } waits, then carries on with the steps after it.\n- branch: { type: 'branch', paths: [{ label, conditions: [...], steps: [...] }], otherwise?: [...] } runs the first path whose conditions hold.\n\nText in send_email, send_slack, send_sms, create_task and set_field may carry merge fields written as {{field_key}} — the field's key, not its id — which fill in from the record that triggered the run.\n\nsend_email, send_slack, send_sms and call_webhook leave the building and are confirmed separately by the user. send_slack needs a connected Slack account and send_sms a connected Twilio account — check with list_connections and ask with request_connection rather than proposing a step that cannot run. Create workflows disabled unless the user asked for them to be live.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string", description: "One line, for whoever reads this workflow next." },
        trigger: { type: "object", description: "{ type, objectKey, fieldId?, offsetDays?, cadence?, weekday?, dayOfMonth? }" },
        steps: { type: "array", items: { type: "object" }, description: "Ordered. See above." },
        enabled: { type: "boolean", description: "Defaults to false — the user turns it on." },
      },
      required: ["name", "trigger", "steps"],
      additionalProperties: false,
    },
  },
  {
    name: "update_automation",
    description:
      "Change a workflow's name, trigger, or steps. `steps` replaces the whole program, so read it first, change it, and send it back.",
    input_schema: {
      type: "object",
      properties: {
        automation_id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        trigger: { type: "object" },
        steps: { type: "array", items: { type: "object" } },
      },
      required: ["automation_id"],
      additionalProperties: false,
    },
  },
  {
    name: "set_automation_enabled",
    description: "Turn an automation on or off.",
    input_schema: {
      type: "object",
      properties: { automation_id: { type: "string" }, enabled: { type: "boolean" } },
      required: ["automation_id", "enabled"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_import_mapping",
    description:
      "Read an uploaded file's column headers and a sample of rows, and propose which column maps to which field.",
    input_schema: {
      type: "object",
      properties: {
        file_id: { type: "string" },
        object_key: { type: "string", enum: [...OBJECT_KEYS] },
      },
      required: ["file_id", "object_key"],
      additionalProperties: false,
    },
  },
  {
    name: "apply_import",
    description: "Run an import in the background using a mapping the user has confirmed.",
    input_schema: {
      type: "object",
      properties: {
        file_id: { type: "string" },
        object_key: { type: "string", enum: [...OBJECT_KEYS] },
        mapping: { type: "object", description: "Column header -> field id." },
        dedupe_key: { type: "string", description: "Field id to match existing records on." },
      },
      required: ["file_id", "object_key", "mapping"],
      additionalProperties: false,
    },
  },
  {
    name: "customize_brand",
    description:
      "Customize the CRM brand identity (workspace name, tagline, logo letters, logo image). Pass logo_file_id with the id of a user-uploaded image to use it as the workspace logo.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The brand/company name, e.g. 'Apex Capital' or 'Acme Corp'." },
        tagline: { type: "string", description: "Brand motto or description." },
        logo_text: { type: "string", description: "1-4 letters for the logo mark, e.g. 'AC' or 'A'." },
        accent_color: { type: "string", description: "Hex color code, e.g. '#ffffff'." },
        logo_file_id: {
          type: "string",
          description: "Id of an attached image upload to use as the workspace logo. Only ever use an id the user attached in this conversation.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "add_custom_agent",
    description: "Create and deploy a new specialized AI agent in this CRM workspace (e.g. Inbound Qualifier, Outreach Assistant, Renewal Sentinel).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the agent, e.g. 'Inbound Lead Qualifier'." },
        role: { type: "string", description: "Short job title/role, e.g. 'Lead Qualification & Scoring'." },
        description: { type: "string", description: "What this agent does." },
        instructions: { type: "string", description: "System instructions and rules for the agent." },
        avatar: { type: "string", description: "Avatar icon keyword, e.g. 'Bot', 'Zap', 'Target'." },
      },
      required: ["name", "role", "instructions"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_custom_agent",
    description: "Remove a custom agent from this CRM.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "The id of the custom agent to remove." },
      },
      required: ["agent_id"],
      additionalProperties: false,
    },
  },
  {
    name: "write_screen",
    description: "Write a screen as a React component. This is the way to build a screen \u2014 `create_screen` composes from a fixed vocabulary and every CRM built that way ends up looking like every other one. Here you decide the layout completely.\n\nWrite one component. No imports: everything below is already in scope. End the file with `export default function Screen() { ... }`.\n\nDATA \u2014 records reach you through these and nothing else. You never name a table or write a query.\n  useRecords(objectKey, { filters?, sort?, search?, limit? })\n      -> { records, total, titles, loading, error, reload }\n      A record is { id, objectKey, data, createdAt, updatedAt } and `data` is keyed BY FIELD ID.\n      `filters` is the same typed tree the views use: { join: \"and\"|\"or\", conditions: [{ fieldId, operator, value }] }\n      `titles` maps a related record's id to its name, for relation fields.\n  createRecord(objectKey, valuesByFieldId) -> { ok, id?, error?, fieldErrors? }\n  updateRecord(recordId, fieldId, value)   -> { ok, error?, fieldErrors? }\n\nWHAT THIS WORKSPACE IS \u2014 read labels from here, never hardcode the customer's words twice.\n  config          the whole configuration\n  objects         objects by key, e.g. objects.deal\n  object          the object this screen was built around, when there is one\n  Each object has { key, label, labelPlural, fields }, and a field is { id, key, label, type, options? }.\n\nKIT \u2014 use these rather than raw markup. A className you invent has no CSS behind it;\nthese carry the tenant's own palette, type and density.\n  Layout    <Page> <Section title action> <Row> <Col> <Grid cols={1-6}> <Card> <Panel> <Divider/>\n  Words     <Heading level={1|2|3}> <Text> <Muted> <Stat label value delta/>\n  Controls  <Button variant=\"primary|secondary|ghost|danger\" size=\"sm\"> <Input> <Select value onChange options placeholder/> <Badge tone=\"neutral|success|warning|danger\"> <Icon name=\"Stethoscope\"/>\n  States    <Loading/> <EmptyState title action> <ErrorNote>\n  Records   <DataTable object records columns={[\"name\",\"amount\"]} titles onRowClick empty/>\n            <Value object fieldKey record titles/>\n            <GroupedBy object records fieldKey render={group => ...}/>\n            sumOf(object, records, \"amount\") -> formatted total\n  DataTable columns are FIELD KEYS (\"amount\"), not ids.\n\nREACT \u2014 useState, useEffect, useMemo, useCallback, useRef are in scope by bare name.\nACTIONS \u2014 openRecord(recordId) opens a record. askAgent(prompt) opens the agent with a question.\n\nRULES\n  Handle all four states. `loading` and `error` come back from useRecords; an empty list needs an\n  <EmptyState> that invites an action, not a shrug.\n  Read field ids from get_schema_summary. `record.data[field.id]`, never `record.data.name`.\n  Sentence case. Active voice on buttons. No emoji.\n  No fetch, no imports, no storage, no window \u2014 they are rejected before the screen is saved.\n\nEXAMPLE \u2014 a clinic's morning:\n\nexport default function Screen() {\n  const patients = objects.contact;\n  const { records, loading, error, titles } = useRecords(\"contact\", { limit: 100 });\n\n  const waiting = records.filter((r) => r.data[fieldId(patients, \"status\")] === \"waiting\");\n\n  if (loading) return <Page><Loading/></Page>;\n  if (error) return <Page><ErrorNote>{error}</ErrorNote></Page>;\n\n  return (\n    <Page>\n      <Row className=\"justify-between\">\n        <Heading level={1}>This morning</Heading>\n        <Button variant=\"primary\" onClick={() => askAgent(\"Add a patient\")}>Add patient</Button>\n      </Row>\n\n      <Grid cols={3}>\n        <Stat label=\"Waiting\" value={waiting.length}/>\n        <Stat label=\"Seen today\" value={records.length - waiting.length}/>\n        <Stat label=\"On the books\" value={records.length}/>\n      </Grid>\n\n      <Section title=\"Waiting room\">\n        <DataTable\n          object={patients}\n          records={waiting}\n          columns={[\"name\", \"phone\", \"status\"]}\n          titles={titles}\n          onRowClick={(record) => openRecord(record.id)}\n          empty={<EmptyState title=\"Nobody is waiting.\">The room is clear.</EmptyState>}\n        />\n      </Section>\n    </Page>\n  );\n}\n\nfunction fieldId(object, key) {\n  return object.fields.find((field) => field.key === key)?.id;\n}",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "What the tab is called, e.g. 'This morning'." },
        icon: { type: "string", description: "A lucide icon name, e.g. 'Stethoscope'." },
        position: { type: "number", description: "Order in the nav. Lower is further left." },
        source: { type: "string", description: "The component. No imports; end with export default." },
      },
      required: ["name", "source"],
      additionalProperties: false,
    },
  },
  {
    name: "rewrite_screen",
    description:
      "Replace a coded screen's component. Read the current one with get_config first, change it, and send the whole component back — there is no partial edit.",
    input_schema: {
      type: "object",
      properties: {
        screen_id: { type: "string" },
        name: { type: "string" },
        icon: { type: "string" },
        position: { type: "number" },
        source: { type: "string", description: "The replacement component." },
      },
      required: ["screen_id", "source"],
      additionalProperties: false,
    },
  },
  {
    name: "create_screen",
    description:
      `Build a screen by composing a tree of nodes. There is no fixed screen type — you decide what the screen is, the way you would decide what a page is made of in HTML.

Every node is { kind, ...props, children? }. Kinds:
  Layout    stack (direction: row|column), grid (cols: 1-12), card, section, panel (side), tabs, tab, divider, spacer
  Content   heading (text), text (text), metric (label + aggregate), badge (text)
  Data      table (query + columns), board (query + pipelineId), list (query), chart (query + groupBy)
  Input     form (objectKey + fields), record_detail (objectKey + fields), search, filters, button (label + action)

A data node needs "query": { objectKey, filters?, sort?, limit? }. A metric needs
"aggregate": { fn: count|sum|avg|min|max, objectKey, fieldId?, filters? } — fieldId is required unless fn is count.
"columns" and "fields" are arrays of real field ids from get_schema_summary.

Every node takes an optional "style" of tokens, never values: pad/gap (none|xs|sm|md|lg), align, tone, size, weight, span (1-12 inside a grid), border, fill (none|surface|sunken|raised|accent), grow, scroll.

Example — a clinic's day at a glance:
{"kind":"stack","children":[
  {"kind":"heading","text":"Today"},
  {"kind":"grid","cols":3,"children":[
    {"kind":"metric","label":"Waiting","aggregate":{"fn":"count","objectKey":"contact","filters":{"join":"and","conditions":[{"fieldId":"fld_status","operator":"is","value":"waiting"}]}}},
    {"kind":"metric","label":"Seen today","aggregate":{"fn":"count","objectKey":"activity"}},
    {"kind":"metric","label":"Avg wait","aggregate":{"fn":"avg","objectKey":"contact","fieldId":"fld_wait"}}
  ]},
  {"kind":"stack","direction":"row","children":[
    {"kind":"stack","style":{"grow":true},"children":[
      {"kind":"search"},
      {"kind":"table","query":{"objectKey":"contact"},"columns":["fld_name","fld_status"]}
    ]},
    {"kind":"panel","side":"right","label":"Add patient","children":[
      {"kind":"form","objectKey":"contact","fields":["fld_name","fld_phone"]}
    ]}
  ]}
]}`,
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "What the tab is called, e.g. 'Today' or 'Pipeline'." },
        icon: { type: "string", description: "A lucide icon name, e.g. 'Stethoscope'." },
        position: { type: "number", description: "Order in the sidebar. Lower is higher up." },
        root: { type: "object", description: "The root node of the tree. Usually a stack." },
      },
      required: ["name", "root"],
      additionalProperties: false,
    },
  },
  {
    name: "update_screen",
    description:
      "Change a screen. Passing root replaces the whole tree — that is how you edit a screen: read it with get_config, then send the tree back with your changes.",
    input_schema: {
      type: "object",
      properties: {
        screen_id: { type: "string" },
        name: { type: "string" },
        icon: { type: "string" },
        position: { type: "number" },
        root: { type: "object", description: "The replacement tree." },
      },
      required: ["screen_id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_screen",
    description: "Delete a screen. Destructive: the layout is gone, though no records are touched.",
    input_schema: {
      type: "object",
      properties: { screen_id: { type: "string" } },
      required: ["screen_id"],
      additionalProperties: false,
    },
  },
  {
    name: "set_theme",
    description:
      `Restyle the whole CRM. This changes the real interface — every table, form, button, board and screen — not a preview. Send only what you are changing; everything else keeps its current value.

Design the palette for this customer rather than picking a preset. Choose a base hue that suits the trade, then derive surfaces from it at controlled lightness steps so they sit together. Dark mode is not the default any more than light is.

Contrast is checked when this is staged: body text needs 4.5:1 against its surface, and text on the accent needs 4:1. A palette that fails comes back with the failing pair so you can adjust it.

Two CRMs should not be recognisable as the same product. The component variants below do more of that work than colour does: a flush table on tinted cards with pill buttons has no visual relationship to a bordered table on outlined cards.`,
    input_schema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: [...THEME_MODES],
          description: "Which way derived colours shift, and Tailwind's dark variant.",
        },
        colors: {
          type: "object",
          description:
            "Six-digit hex values. surface is the page; sunken sits behind it; raised sits on it; hover is the row highlight. accent drives buttons, links and focus. accentFg is optional — it is derived from the accent when omitted.",
          properties: {
            surface: { type: "string" },
            sunken: { type: "string" },
            raised: { type: "string" },
            hover: { type: "string" },
            textPrimary: { type: "string" },
            textSecondary: { type: "string" },
            textMuted: { type: "string" },
            borderSubtle: { type: "string" },
            borderStrong: { type: "string" },
            accent: { type: "string" },
            accentFg: { type: "string" },
            danger: { type: "string" },
            success: { type: "string" },
            warning: { type: "string" },
          },
        },
        type: {
          type: "object",
          description:
            "baseSize is body text in px (11-20). scaleRatio steps every other size off it — 1.125 is a dense tool, 1.414 is a magazine. fontDisplay differs from fontBody for editorial contrast.",
          properties: {
            fontBody: { type: "string", enum: [...THEME_FONTS] },
            fontDisplay: { type: "string", enum: [...THEME_FONTS] },
            baseSize: { type: "number" },
            scaleRatio: { type: "number" },
            lineHeight: { type: "number" },
            weightDisplay: { type: "number", description: "300-900." },
            weightBody: { type: "number" },
            tracking: { type: "number", description: "em. Negative tightens a display face." },
            uppercaseHeadings: { type: "boolean" },
          },
        },
        space: {
          type: "object",
          description:
            "unit is the base step in px — 2 is a dense terminal, 6 is airy. rowHeight sets how many records fit on a screen.",
          properties: {
            unit: { type: "number" },
            ratio: { type: "number" },
            rowHeight: { type: "number" },
            controlHeight: { type: "number" },
          },
        },
        shape: {
          type: "object",
          description: "Corner radii in px — 0 is square, 9999 is a pill. borderWidth 0 removes borders entirely.",
          properties: {
            radiusSm: { type: "number" },
            radiusMd: { type: "number" },
            radiusLg: { type: "number" },
            borderWidth: { type: "number" },
            focusWidth: { type: "number" },
            focusOffset: { type: "number" },
          },
        },
        shadow: {
          type: "object",
          description: "none is a flat, bordered design. soft and above trade borders for depth.",
          properties: {
            style: { type: "string", enum: [...SHADOW_STYLES] },
            color: { type: "string" },
            opacity: { type: "number" },
          },
        },
        motion: {
          type: "object",
          properties: {
            easing: { type: "string", enum: [...THEME_EASINGS] },
            durationFast: { type: "number" },
            duration: { type: "number" },
          },
        },
        components: {
          type: "object",
          description: "How each component draws itself. This is where visual identity mostly comes from.",
          properties: {
            table: { type: "string", enum: [...TABLE_VARIANTS] },
            card: { type: "string", enum: [...CARD_VARIANTS] },
            button: { type: "string", enum: [...BUTTON_VARIANTS] },
            badge: { type: "string", enum: [...BADGE_VARIANTS] },
            tabs: { type: "string", enum: [...TABS_VARIANTS] },
            input: { type: "string", enum: [...INPUT_VARIANTS] },
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "update_plan",
    description:
      "Post or update your checklist for this turn, shown to the user while you work. Call it once up front with the steps you intend to take, then again as each one finishes. Use it for anything that takes more than a couple of tool calls.",
    input_schema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "One short line, in the user's terms." },
              status: { type: "string", enum: ["pending", "active", "done"] },
            },
            required: ["text", "status"],
          },
        },
      },
      required: ["steps"],
      additionalProperties: false,
    },
  },
  {
    name: "suggest_next",
    description:
      "Offer two or three follow-ups as buttons under your reply. Each is sent back verbatim as the user's next message if they tap it, so write them as instructions, not questions about what you did.",
    input_schema: {
      type: "object",
      properties: {
        suggestions: { type: "array", items: { type: "string" } },
      },
      required: ["suggestions"],
      additionalProperties: false,
    },
  },
  {
    name: "reset_workspace",
    description:
      "Clear this workspace back to empty — no objects, no screens, no workflows — before building a CRM for a different business than the one currently here.\n\nUse it when someone asks for a CRM for a trade this workspace is not already built for. Building a B2B sales CRM on top of a restaurant leaves the restaurant's screens sitting in the navigation next to the new ones, which is the most confusing thing this product can do.\n\nDo NOT use it when they are changing, adding to, or fixing what is already here — that is a refinement, and resetting would throw away their work. If you are unsure which they meant, ask.\n\nRecords are not deleted, but their objects are, so anything stored becomes unreachable. The user is told how many before it applies.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "create_object",
    description:
      "Add an object this business actually has. A clinic has Appointments, a supermarket has Products, a firm has Matters — none of which is a contact, a company or a deal wearing a different label. Give it the handful of fields it needs; a relation field needs a relation, so create that first with create_relation.",
    input_schema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "lower_snake_case and permanent, e.g. 'appointment'. Records are stored under it.",
        },
        label: { type: "string", description: "Singular, e.g. 'Appointment'." },
        label_plural: { type: "string", description: "Plural, e.g. 'Appointments'." },
        fields: {
          type: "array",
          description: "Each { label, type, options?, required? }. Types are the field type list.",
          items: { type: "object" },
        },
      },
      required: ["key", "label", "label_plural", "fields"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_object",
    description:
      "Remove an object. Destructive, and refused while a view, pipeline, workflow or relation still points at it — remove those first. Ask before proposing this, and say how many records it leaves behind.",
    input_schema: {
      type: "object",
      properties: { object_key: { type: "string" } },
      required: ["object_key"],
      additionalProperties: false,
    },
  },
  {
    name: "customize_object",
    description: "Rename an object — 'Contact' to 'Patient', 'Company' to 'Practice'. Use create_object when the business has a thing none of the existing objects is.",
    input_schema: {
      type: "object",
      properties: {
        object_key: { type: "string" },
        label: { type: "string", description: "Singular name, e.g. 'Startup'." },
        label_plural: { type: "string", description: "Plural name, e.g. 'Startups'." },
      },
      required: ["object_key", "label", "label_plural"],
      additionalProperties: false,
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Execution                                                                   */
/* -------------------------------------------------------------------------- */

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const { config } = context;

  try {
    switch (name) {
      case "list_connections": {
        const list = context.connections ?? [];
        return {
          patches: [],
          message: JSON.stringify(
            list.map((c) => ({
              provider: c.provider,
              label: c.label,
              connected: c.connected,
              ...(c.account ? { account: c.account } : {}),
            })),
          ),
        };
      }

      case "request_connection": {
        const provider = String(input.provider ?? "");
        const known = (context.connections ?? []).find((c) => c.provider === provider);
        if (!known) {
          return {
            patches: [],
            message: `No connector called '${provider}'. Call list_connections for the available ones.`,
            isError: true,
          };
        }
        if (known.connected) {
          return {
            patches: [],
            message: `${known.label} is already connected as ${known.account}. Continue with the task.`,
          };
        }

        context.onConnectRequest?.({
          provider,
          label: known.label,
          reason: String(input.reason ?? `Connecting ${known.label} is needed to continue.`),
        });

        return {
          patches: [],
          message: `Offered ${known.label} to the user. Stop here and wait — do not assume it is connected.`,
        };
      }

      case "get_config":
        return { patches: [], message: JSON.stringify(config) };

      case "get_schema_summary":
        return { patches: [], message: JSON.stringify(schemaSummary(context)) };

      case "add_field": {
        const object = findObject(config, String(input.object_key));
        if (!object) return fail(`There is no ${String(input.object_key)} object.`);
        const taken = new Set(object.fields.map((field) => field.key));
        const type = String(input.type);
        const options = optionsFrom(input.options);

        return stage({
          op: "add_field",
          objectKey: object.key,
          field: {
            id: id("fld"),
            key: keyFrom(String(input.label), taken),
            label: String(input.label),
            type,
            required: Boolean(input.required ?? false),
            system: false,
            ...(options ? { options } : {}),
            ...(input.default !== undefined ? { default: input.default } : {}),
          },
        });
      }

      case "update_field": {
        const found = findField(config, String(input.field_id));
        if (!found) return fail(`There is no field ${String(input.field_id)}.`);
        const options = optionsFrom(input.options);
        return stage({
          op: "update_field",
          fieldId: found.field.id,
          ...(input.label !== undefined ? { label: String(input.label) } : {}),
          ...(input.required !== undefined ? { required: Boolean(input.required) } : {}),
          ...(options ? { options } : {}),
          ...(input.default !== undefined ? { default: input.default } : {}),
        });
      }

      case "remove_field":
        return stage({ op: "remove_field", fieldId: String(input.field_id) });

      case "create_relation":
        return stage({
          op: "create_relation",
          relation: {
            key: keyFrom(
              `${String(input.from_object)}_${String(input.label)}`,
              new Set(config.relations.map((relation) => relation.key)),
            ),
            fromObject: String(input.from_object),
            toObject: String(input.to_object),
            kind: String(input.kind),
            label: String(input.label),
          },
        });

      case "reorder_fields":
        return stage({
          op: "reorder_fields",
          objectKey: String(input.object_key),
          fieldIds: (input.field_ids as string[]) ?? [],
        });

      case "create_view":
        return stage({
          op: "create_view",
          view: {
            id: id("vw"),
            objectKey: String(input.object_key),
            name: String(input.name),
            renderer: String(input.renderer),
            columns: (input.columns as string[]) ?? [],
            ...(input.filters ? { filters: input.filters } : {}),
            ...(input.sort ? { sort: input.sort } : {}),
            ...(input.group_by ? { groupBy: String(input.group_by) } : {}),
            ...(input.pipeline_id ? { pipelineId: String(input.pipeline_id) } : {}),
          },
        });

      case "update_view":
        return stage({
          op: "update_view",
          viewId: String(input.view_id),
          ...(input.name !== undefined ? { name: String(input.name) } : {}),
          ...(input.columns !== undefined ? { columns: input.columns as string[] } : {}),
          ...(input.filters !== undefined ? { filters: input.filters } : {}),
          ...(input.sort !== undefined ? { sort: input.sort } : {}),
          ...(input.group_by !== undefined ? { groupBy: String(input.group_by) } : {}),
        });

      case "delete_view":
        return stage({ op: "delete_view", viewId: String(input.view_id) });

      case "create_pipeline": {
        const stages = (input.stages as { label: string }[]) ?? [];
        const taken = new Set<string>();
        return stage({
          op: "create_pipeline",
          pipeline: {
            id: id("pl"),
            objectKey: String(input.object_key),
            name: String(input.name),
            stageFieldId: String(input.stage_field_id),
            stages: stages.map((entry) => {
              const key = keyFrom(entry.label, taken);
              taken.add(key);
              return { key, ...entry };
            }),
          },
        });
      }

      case "update_pipeline": {
        const pipeline = config.pipelines.find((p) => p.id === String(input.pipeline_id));
        const stages = input.stages as ({ key?: string; label: string } | undefined)[] | undefined;
        const taken = new Set(pipeline?.stages.map((entry) => entry.key) ?? []);

        return stage({
          op: "update_pipeline",
          pipelineId: String(input.pipeline_id),
          ...(input.name !== undefined ? { name: String(input.name) } : {}),
          ...(stages
            ? {
                stages: stages.filter(Boolean).map((entry) => ({
                  key: entry!.key ?? keyFrom(entry!.label, taken),
                  ...entry,
                })),
              }
            : {}),
          ...(input.stage_migrations ? { stageMigrations: input.stage_migrations } : {}),
        });
      }

      case "create_automation":
        return stage({
          op: "create_automation",
          automation: {
            id: id("au"),
            name: String(input.name),
            ...(input.description !== undefined ? { description: String(input.description) } : {}),
            // Off unless asked for. A workflow that starts running the moment
            // it is described is a workflow nobody agreed to.
            enabled: input.enabled === true,
            trigger: input.trigger,
            steps: withStepIds(input.steps),
          },
        });

      case "update_automation":
        return stage({
          op: "update_automation",
          automationId: String(input.automation_id),
          ...(input.name !== undefined ? { name: String(input.name) } : {}),
          ...(input.description !== undefined ? { description: String(input.description) } : {}),
          ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
          ...(input.steps !== undefined ? { steps: withStepIds(input.steps) } : {}),
        });

      case "set_automation_enabled":
        return stage({
          op: "set_automation_enabled",
          automationId: String(input.automation_id),
          enabled: Boolean(input.enabled),
        });

      case "propose_import_mapping": {
        if (!context.sampleImportFile) return fail("No file is available to read.");
        const sample = await context.sampleImportFile(String(input.file_id));
        const object = findObject(config, String(input.object_key));
        if (!object) return fail(`There is no ${String(input.object_key)} object.`);

        // At most 20 rows ever reach the model. The full file never does.
        return {
          patches: [],
          message: JSON.stringify({
            headers: sample.headers,
            sampleRows: sample.rows.slice(0, 20),
            fields: object.fields.map((field) => ({ id: field.id, label: field.label, type: field.type })),
          }),
        };
      }

      case "apply_import": {
        context.onImportProposal?.({
          fileId: String(input.file_id),
          objectKey: String(input.object_key),
          mapping: (input.mapping as Record<string, string>) ?? {},
          dedupeKey: input.dedupe_key ? String(input.dedupe_key) : undefined,
          unmapped: [],
        });
        return {
          patches: [],
          message:
            "The import is staged. It runs as a background job once the user confirms it, and imports records rather than changing configuration.",
        };
      }

      case "customize_brand": {
        const nameVal = String(input.name ?? "").trim();
        if (!nameVal) return fail("Brand name is required.");
        let logoFileId: string | undefined;
        const logoRaw = input.logo_file_id;
        if (logoRaw !== undefined && logoRaw !== null && String(logoRaw).trim() !== "") {
          const resolved = context.resolveUploadFile
            ? await context.resolveUploadFile(String(logoRaw).trim())
            : null;
          if (!resolved) {
            return fail("That logo file could not be found. Ask the user to attach the image again.");
          }
          if (resolved.kind !== "image") {
            return fail(`"${resolved.filename}" is not an image, so it cannot be a logo.`);
          }
          logoFileId = resolved.id;
        }
        return stage({
          op: "update_brand",
          brand: {
            name: nameVal,
            tagline: input.tagline ? String(input.tagline).trim() : undefined,
            logoText: input.logo_text ? String(input.logo_text).trim().toUpperCase() : nameVal.slice(0, 2).toUpperCase(),
            accentColor: input.accent_color ? String(input.accent_color) : "#ffffff",
            logoFileId,
          },
        });
      }

      case "add_custom_agent": {
        const nameVal = String(input.name ?? "").trim();
        const roleVal = String(input.role ?? "").trim();
        const instVal = String(input.instructions ?? "").trim();
        if (!nameVal || !roleVal || !instVal) {
          return fail("Agent name, role, and instructions are required.");
        }
        return stage({
          op: "add_custom_agent",
          agent: {
            id: id("agent"),
            name: nameVal,
            role: roleVal,
            description: input.description ? String(input.description).trim() : `AI Agent specialized for ${roleVal}`,
            instructions: instVal,
            avatar: input.avatar ? String(input.avatar) : "Bot",
            enabled: true,
          },
        });
      }

      case "remove_custom_agent": {
        const agentId = String(input.agent_id ?? "").trim();
        if (!agentId) return fail("Agent id is required.");
        return stage({
          op: "remove_custom_agent",
          agentId,
        });
      }

      case "write_screen": {
        const name = String(input.name ?? "").trim();
        if (!name) return fail("A screen needs a name.");
        const source = String(input.source ?? "");
        if (!source.trim()) return fail("A screen needs a component.");

        // Say what is wrong here rather than letting the patch validator say it
        // in schema terms — the model retries once, and it should retry
        // against a sentence it can act on.
        const problem = checkScreenSource(source);
        if (problem) return fail(`That screen does not compile: ${problem}`);

        return stage({
          op: "create_screen",
          screen: {
            id: id("scr"),
            name,
            position: typeof input.position === "number" ? input.position : (config.screens ?? []).length,
            ...(input.icon ? { icon: String(input.icon) } : {}),
            source,
          },
        });
      }

      case "rewrite_screen": {
        const screenId = String(input.screen_id ?? "").trim();
        const existing = (config.screens ?? []).find((candidate) => candidate.id === screenId);
        if (!existing) return fail(`There is no screen ${screenId}. Call get_config for the ones that exist.`);
        if (existing.root) {
          return fail(
            `"${existing.name}" is a composed screen, not a coded one. Use update_screen to change its layout, or delete_screen and write_screen to replace it with code.`,
          );
        }

        const source = String(input.source ?? "");
        if (!source.trim()) return fail("A screen needs a component.");
        const problem = checkScreenSource(source);
        if (problem) return fail(`That screen does not compile: ${problem}`);

        return stage({
          op: "update_screen",
          screenId,
          ...(input.name !== undefined ? { name: String(input.name) } : {}),
          ...(input.icon !== undefined ? { icon: String(input.icon) } : {}),
          ...(typeof input.position === "number" ? { position: input.position } : {}),
          source,
        });
      }

      case "create_screen": {
        const name = String(input.name ?? "").trim();
        if (!name) return fail("A screen needs a name.");
        if (!input.root || typeof input.root !== "object") {
          return fail("A screen needs a root node, e.g. { kind: 'stack', children: [...] }.");
        }
        return stage({
          op: "create_screen",
          screen: {
            id: id("scr"),
            name,
            position: typeof input.position === "number" ? input.position : (config.screens ?? []).length,
            ...(input.icon ? { icon: String(input.icon) } : {}),
            root: input.root,
          },
        });
      }

      case "update_screen": {
        const screenId = String(input.screen_id ?? "").trim();
        const screen = (config.screens ?? []).find((candidate) => candidate.id === screenId);
        if (!screen) return fail(`There is no screen ${screenId}. Call get_config for the ones that exist.`);

        return stage({
          op: "update_screen",
          screenId,
          ...(input.name !== undefined ? { name: String(input.name) } : {}),
          ...(input.icon !== undefined ? { icon: String(input.icon) } : {}),
          ...(input.position !== undefined ? { position: Number(input.position) } : {}),
          ...(input.root !== undefined ? { root: input.root } : {}),
        });
      }

      case "delete_screen": {
        const screenId = String(input.screen_id ?? "").trim();
        if (!(config.screens ?? []).some((candidate) => candidate.id === screenId)) {
          return fail(`There is no screen ${screenId}.`);
        }
        return stage({ op: "delete_screen", screenId });
      }

      case "set_theme": {
        const groups = ["colors", "type", "space", "shape", "shadow", "motion", "components"] as const;
        const theme: Record<string, unknown> = {};

        if (input.mode !== undefined) theme.mode = String(input.mode);
        for (const group of groups) {
          const value = input[group];
          if (value && typeof value === "object") theme[group] = value;
        }

        if (Object.keys(theme).length === 0) {
          return fail("Say what to change: mode, colors, type, space, shape, shadow, motion, or components.");
        }

        // Merge onto the live theme before checking, because a palette is only
        // readable or not as a whole — changing one colour can break a pair.
        const merged = resolveTheme({
          ...config.theme,
          ...theme,
          colors: { ...config.theme?.colors, ...(theme.colors as object) },
        } as Parameters<typeof resolveTheme>[0]);

        const problems = assertReadable(merged);
        if (problems.length > 0) {
          return fail(
            `That palette is not readable. ${problems.join(" ")} Adjust the lightness of those colours and try again.`,
          );
        }

        return stage({ op: "update_theme", theme });
      }

      case "update_plan": {
        const raw = Array.isArray(input.steps) ? input.steps : [];
        const steps: PlanStep[] = raw.slice(0, 12).map((entry) => {
          const step = entry as { text?: unknown; status?: unknown };
          const status = String(step.status ?? "pending");
          return {
            text: String(step.text ?? "").slice(0, 120),
            status: status === "active" || status === "done" ? status : "pending",
          };
        });

        if (steps.length === 0) return fail("A plan needs at least one step.");

        context.onPlan?.(steps);
        const done = steps.filter((step) => step.status === "done").length;
        return { patches: [], message: `Plan shown to the user: ${done}/${steps.length} done.` };
      }

      case "suggest_next": {
        const raw = Array.isArray(input.suggestions) ? input.suggestions : [];
        const suggestions = raw
          .map((entry) => String(entry).trim().slice(0, 120))
          .filter(Boolean)
          .slice(0, 4);

        if (suggestions.length === 0) return fail("Give at least one suggestion.");

        context.onSuggestions?.(suggestions);
        return { patches: [], message: "Offered to the user as buttons." };
      }

      case "reset_workspace":
        return stage({ op: "reset_to_blank", config: startingConfig() });

      case "create_object": {
        const key = String(input.key ?? "").trim();
        if (!/^[a-z][a-z0-9_]*$/.test(key)) {
          return fail("An object key is lower_snake_case and starts with a letter, e.g. 'appointment'.");
        }
        if (findObject(config, key)) return fail(`This workspace already has a ${key} object.`);

        const label = String(input.label ?? "").trim();
        const labelPlural = String(input.label_plural ?? "").trim();
        if (!label || !labelPlural) return fail("An object needs a singular and a plural name.");

        const given = Array.isArray(input.fields) ? input.fields : [];
        if (given.length === 0) return fail("An object needs at least one field — usually a name.");

        const taken = new Set<string>();
        const fields = given.map((entry) => {
          const field = (entry ?? {}) as Record<string, unknown>;
          const fieldLabel = String(field.label ?? "Field");
          const fieldKey = keyFrom(fieldLabel, taken);
          taken.add(fieldKey);
          const options = optionsFrom(field.options);
          return {
            id: id("fld"),
            key: fieldKey,
            label: fieldLabel,
            type: String(field.type ?? "text"),
            required: Boolean(field.required ?? false),
            system: false,
            ...(options ? { options } : {}),
          };
        });

        return stage({
          op: "create_object",
          object: {
            key,
            label,
            labelPlural,
            // The first field is what a record is called in a list, unless the
            // model said otherwise by naming one "name".
            titleFieldId: (fields.find((field) => field.key === "name") ?? fields[0])!.id,
            fields,
            layout: { groups: [] },
          },
        });
      }

      case "delete_object": {
        const object = findObject(config, String(input.object_key));
        if (!object) return fail(`There is no ${String(input.object_key)} object.`);
        return stage({ op: "delete_object", objectKey: object.key });
      }

      case "customize_object": {
        const key = String(input.object_key);
        const obj = findObject(config, key);
        if (!obj) return fail(`There is no ${key} object.`);
        const label = String(input.label ?? "").trim();
        const labelPlural = String(input.label_plural ?? "").trim();
        if (!label || !labelPlural) return fail("Label and plural label are required.");
        return stage({
          op: "update_object_label",
          objectKey: obj.key,
          label,
          labelPlural,
        });
      }

      default:
        return fail(`${name} is not a tool this agent has.`);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function stage(raw: unknown): ToolOutcome {
  // Parsing here means a malformed patch is caught at the tool boundary, with a
  // message the model can act on, rather than at apply time.
  const patch = parsePatch(raw);
  const created = createdId(patch);

  // The id goes back to the model because building a CRM is a sequence: add a
  // choice field, build the pipeline on it, then put a board over that. Without
  // the id, the second step has nothing to point at.
  const detail = mintedDetail(patch);

  return {
    patches: [patch],
    message: [
      created
        ? `Staged, with id ${created}. Use that id for any later step in this turn that refers to it.`
        : "Staged.",
      detail,
      "The user sees the whole turn as one diff.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * Anything else the tool minted that the model would otherwise have to guess.
 * A choice field's option values are derived from its labels, so without this
 * the model filters on "In chair" while records hold "in_chair", and the screen
 * it just built quietly reads zero.
 */
function mintedDetail(patch: ConfigPatch): string | undefined {
  if (patch.op === "add_field" && patch.field.options?.length) {
    const pairs = patch.field.options.map((option) => `${option.value} = "${option.label}"`).join(", ");
    return `Its option values are ${pairs}. Filters and defaults must use the value, never the label.`;
  }
  return undefined;
}

function createdId(patch: ConfigPatch): string | undefined {
  switch (patch.op) {
    case "add_field":
      return patch.field.id;
    case "create_view":
      return patch.view.id;
    case "create_pipeline":
      return patch.pipeline.id;
    case "create_automation":
      return patch.automation.id;
    case "create_relation":
      return patch.relation.key;
    case "add_custom_agent":
      return patch.agent.id;
    case "create_screen":
      return patch.screen.id;
    default:
      return undefined;
  }
}

function fail(message: string): ToolOutcome {
  return { patches: [], message, isError: true };
}

export function schemaSummary(context: ToolContext): unknown {
  return {
    objects: context.config.objects.map((object) => ({
      key: object.key,
      label: object.labelPlural,
      recordCount: context.counts[object.key] ?? 0,
      fields: object.fields.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        required: field.required,
        system: field.system,
        // Both halves: a filter matches the stored value, while the label is
        // what a person reads. Sending labels alone is how a filter ends up
        // comparing against text no record holds.
        ...(field.options
          ? { options: field.options.map((option) => ({ value: option.value, label: option.label })) }
          : {}),
      })),
    })),
    views: context.config.views.map((view) => ({
      id: view.id,
      name: view.name,
      objectKey: view.objectKey,
      renderer: view.renderer,
    })),
    pipelines: context.config.pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      objectKey: pipeline.objectKey,
      stageFieldId: pipeline.stageFieldId,
      stages: pipeline.stages.map((stage) => stage.label),
    })),
    automations: context.config.automations.map((automation) => ({
      id: automation.id,
      name: automation.name,
      enabled: automation.enabled,
    })),
  };
}
