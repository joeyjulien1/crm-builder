# Agent tools

This is the agent's entire surface. If it isn't here, the agent cannot do it.

Every tool returns a **patch**, not a result. Patches accumulate across a turn, validate as a
set, render as one diff, and apply as one config version on confirmation. A turn that produces
an invalid patch shows the validation error to the agent and lets it retry once, then surfaces
the failure to the user.

## Schema

| Tool | Arguments | Notes |
|---|---|---|
| `add_field` | object_key, label, type, options?, required?, default? | type from the field type list below |
| `update_field` | field_id, label?, options?, required?, default? | cannot change type — see below |
| `remove_field` | field_id | destructive; patch carries affected record count |
| `create_relation` | from_object, to_object, kind, label | kind: one_to_many, many_to_many |
| `reorder_fields` | object_key, field_ids[] | display order only |

Changing a field's type is deliberately not a tool. It is a data migration, not a config edit.
The agent should propose adding a new field and offer to backfill, which is a separate,
explicitly confirmed operation.

## Views

| Tool | Arguments |
|---|---|
| `create_view` | object_key, name, renderer, columns[], filters?, sort?, group_by? |
| `update_view` | view_id, name?, columns?, filters?, sort?, group_by? |
| `delete_view` | view_id |

`renderer` must be one of: `table`, `kanban`, `detail`. Anything else fails validation. The
renderer list is bounded by `docs/COMPONENTS.md` — keep them in sync.

## Pipelines

| Tool | Arguments |
|---|---|
| `create_pipeline` | object_key, name, stages[] |
| `update_pipeline` | pipeline_id, name?, stages? |

Stages carry `key`, `label`, `probability?`, `is_won?`, `is_lost?`. Removing a stage that holds
records requires a target stage in the patch — the agent must ask where those records go.

## Workflows

| Tool | Arguments |
|---|---|
| `create_automation` | name, description?, trigger, steps[], enabled? |
| `update_automation` | automation_id, name?, description?, trigger?, steps? |
| `set_automation_enabled` | automation_id, enabled |

A workflow is a trigger and then an **ordered list of steps**. It used to be
`{trigger, conditions[], actions[]}` — every condition evaluated up front, every action run
unconditionally after — which cannot express "check this, then wait two days, then do one thing
or the other". `steps` replaces both. Reading either shape still works: `normalizeAutomation` in
`lib/config/schema.ts` turns a stored `conditions[]` into a leading `filter` step, on the write
path and in `hydrateConfig` on the read path. Keep that reader.

**Triggers**

| Trigger | Fires |
|---|---|
| `record_created`, `record_updated`, `field_changed` | on a write, matched in `lib/automations/dispatch.ts` |
| `form_submitted` | on a form submission |
| `date_reached` | on the daily sweep, once per record whose date has arrived |
| `schedule` | on the daily sweep, once per matching record, on the cadence |
| `webhook_received` | when something POSTs to that workflow's endpoint |

**Steps.** Seven do something; three control the run.

| Step | Does |
|---|---|
| `set_field`, `create_record`, `create_task` | writes to this workspace |
| `send_email`, `send_slack`, `send_sms`, `call_webhook` | leaves the building |
| `filter` | stops the run unless its conditions hold |
| `delay` | suspends the run and resumes at the next step later |
| `branch` | runs the first path whose conditions hold, else `otherwise` |

Branches nest, capped at three deep, and a workflow is capped at 60 steps in total. Every step
carries an `id`; the agent need not invent them, `withStepIds` mints any that are missing.

`send_email`, `send_slack`, `send_sms` and `call_webhook` are flagged in the diff as external
effects and require separate confirmation even inside an approved patch. An agent that can
silently email a customer's contact list is a product you can't sell. `send_slack` and `send_sms`
also need a connected account — ask with `request_connection` rather than proposing a step that
cannot run.

**Merge fields.** Text in the steps above may carry `{{field_key}}`, resolved against the record
that triggered the run by `lib/automations/merge.ts`. A token that resolves to nothing renders
empty and is reported in the run log — never left on the page as literal braces.

**Delays and resumption.** A delay re-queues the rest of the run with `startAfter` and a cursor
saying where to carry on (`lib/automations/steps.ts`). The resumed leg carries its own idempotency
key, so retries stay safe and a two-day wait does not make the second half look like a duplicate
of the first.

## Objects

| Tool | Arguments |
|---|---|
| `create_object` | key, label, label_plural, fields[] |
| `delete_object` | object_key |
| `customize_object` | object_key, label, label_plural |

`OBJECT_KEYS` was a closed enum of four, and it meant a clinic could rename `contact` to "Patient"
but could not have Appointments. The data layer never required it — `records.object_key` is plain
text with no constraint, on purpose — so the set is open and the guarantee moved to a referential
check in `configSchema`: an object key that names nothing fails validation. `delete_object` refuses
while a view, pipeline, workflow or relation still points at the object, and its impact entry
carries the record count it would leave behind.

**A new workspace has no objects.** Building the model is the agent's first job, and the prompt is
explicit that reaching for contacts/companies/deals is how a non-sales business ends up with a
sales pipeline wearing its words.

## Screens

| Tool | Arguments |
|---|---|
| `write_screen` | name, source, icon?, position? |
| `rewrite_screen` | screen_id, source, name?, icon?, position? |
| `create_screen` | name, root, icon?, position? |
| `update_screen` | screen_id, name?, root?, icon?, position? |
| `delete_screen` | screen_id |

**A screen is written one of two ways, and `write_screen` is the default.** It takes a React
component — no imports, ending in `export default function Screen()`. There is no vocabulary and no
ceiling: the layout is whatever the business needs. `create_screen` composes the closed node tree
instead, and is the right choice only when the user wants a screen they can edit block by block in
the backend editor.

`checkScreenSource` parses the component before the patch is staged — the agent is told which line
failed and rewrites it, so a screen that cannot compile is never stored. The apply route runs the
same check, which covers the editor's own source box.

What a coded screen can reach is `components/generated/scope.ts` and nothing else — React and its
hooks, the kit (`<Page> <Card> <Stat> <DataTable> <GroupedBy>` …), and a data client
(`useRecords`, `createRecord`, `updateRecord`). It is compiled and run in the browser only, never
on the server, and its queries are compiled server-side from the same typed filter tree the views
use. `forbiddenInSource` rejects imports, `fetch`, storage and window navigation before the patch
is staged, so the model gets a sentence it can act on rather than a blank screen.

`root` is a tree of nodes: `{ kind, ...props, children? }`. The kinds are listed in
`docs/COMPONENTS.md` and the agent composes them freely — there is no screen type to pick from
and no template. `update_screen` replaces the whole tree, which is how a screen is edited: read
it, change it, send it back.

A data node carries `query` ({ objectKey, filters?, sort?, limit? }); a metric carries
`aggregate` ({ fn, objectKey, fieldId?, filters? }). Both are the same typed filter tree the
views use, so a generated screen reaches no further into the database than a hand-built one, and
`lib/runtime/screen.ts` is what compiles them.

Two things the agent has to be told, because it cannot infer them:

- Field ids come from `get_schema_summary`. A column pointing at an id that does not exist
  renders empty rather than failing.
- A choice field is filtered on the option's **value**, not its label — `waiting`, not
  `"Waiting"`. `get_schema_summary` returns both, and `add_field` reports the values it minted,
  because a filter on the label matches nothing and the screen silently reads zero.

## Appearance

| Tool | Arguments |
|---|---|
| `set_theme` | mode?, accent?, neutral?, radius?, density?, font? |
| `customize_brand` | name, tagline?, logo_text?, accent_color?, logo_file_id? |
| `customize_object` | object_key, label, label_plural |

`set_theme` restyles the real CRM, not a preview. It works because every Tailwind utility in
the product resolves to a CSS variable (`app/globals.css`, `tailwind.config.ts`), and
`lib/config/theme.ts` maps the theme config onto those variables. The app shell sets them as an
inline style, so no CSS is ever built by concatenating config into a string.

Every argument is a closed set except `accent`, which is a six-digit hex:

- `mode`: light, dark
- `neutral`: zinc, slate, stone, gray — the grey family everything is built from
- `radius`: square, small, medium, large, pill
- `density`: compact (34px rows, the CRM default), comfortable
- `font`: system, geometric, grotesk, serif, mono — system stacks only

Closed sets are the point. A tenant that can set every surface colour independently is a tenant
that can render its own CRM unreadable, and the only way back is a rollback. Picking a ramp
keeps contrast legal whatever the agent chooses.

This is styling, not layout. Layout is `create_screen`, above.

## Working out loud

| Tool | Arguments |
|---|---|
| `update_plan` | steps[] of { text, status: pending \| active \| done } |
| `suggest_next` | suggestions[] |

Neither returns a patch and neither touches config; they drive the panel. `update_plan` posts
the agent's checklist before it starts and again as each step finishes, so the ticks track tool
calls that actually happened rather than an animation. `suggest_next` offers follow-ups as
buttons, sent back verbatim as the user's next message.

These exist because a whole-CRM build is a dozen tool calls over a minute or more, and a
progress bar that is not attached to real work is a lie the user will eventually catch.

## Import

| Tool | Arguments |
|---|---|
| `propose_import_mapping` | file_id | reads column headers and a sample of rows |
| `apply_import` | mapping, dedupe_key | runs as a background job, not inline |

This is the one place the agent sees customer data, and only because the user handed it over.
Sample at most 20 rows. Never send the full file to the model.

Import, like the appearance and plan tools above, is an exception to "every tool returns a patch": an import creates records, and records
are not configuration, so there is no config version to write. They return a proposal that goes
through the same confirm-before-anything-happens path, and `apply_import` then runs as a background
job. Everything else on this page returns a patch.

## Connectors

| Tool | Arguments |
|---|---|
| `list_connections` | — |
| `request_connection` | provider, reason |

`request_connection` offers a button in the conversation. It does not connect anything: the OAuth
grant is the user's to give, in a popup, and the agent never sees a token or a scope it did not ask
the user for. This is the one tool that returns neither a patch nor data — it asks for consent.

The provider list is configuration (`lib/connectors/registry.ts`), not part of this contract. Adding
Slack is a config entry; it is not a new tool and not a new component.

A task that needs an account the user has not connected ends with `request_connection` and stops.
Carrying on as though the account were connected is the failure mode to design against.

## Read tools

| Tool | Returns |
|---|---|
| `get_config` | current resolved config |
| `get_schema_summary` | objects, fields, types, record counts per object |
| `get_config_history` | last 20 versions with summaries |

Note what's absent: there is no tool that reads record contents. The agent knows a tenant has
1,847 deals; it does not know who they're with.

## Field types

`text`, `long_text`, `number`, `currency`, `date`, `datetime`, `boolean`, `select`,
`multi_select`, `email`, `phone`, `url`, `relation`, `user`.

Adding a type means adding a renderer, a filter predicate, an import coercion, and a form
input. It is a four-file change, not a one-line change. Treat the list as closed for v1.

## System prompt shape

The agent's system prompt should carry: the invariants from `CLAUDE.md`, the current config
summary, the tool list, and a strong instruction to ask before destructive changes rather than
proposing them. Keep it under ~2k tokens — the config summary is the expensive part, so send
counts and shapes, not the full config, unless a tool asks for it.

Rules worth stating explicitly in that prompt:
- Propose the smallest change that solves the stated problem.
- When a request is ambiguous, ask one question rather than guessing.
- Never propose removing something the user didn't mention.
- Explain what a change will do in the user's terms, not in schema terms.
