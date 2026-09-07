# Components

Three layers now, and it matters which one a change belongs to.

## Screens are written two ways

A screen holds either a **composed tree** or a **React component the agent wrote**.

The tree came first: a closed vocabulary of 22 node kinds an interpreter draws. It is safe,
editable block by block in the backend editor, and it has a ceiling — the vocabulary. Measured
against real output, that ceiling plus a seeded starter CRM is why two generated workspaces used
to look like the same product repainted.

`source` has no vocabulary and no ceiling. It is compiled in the browser by
`components/generated/compile.ts` and evaluated against `components/generated/scope.ts` — React,
the kit in `kit.tsx`, and a data client. Four properties hold it together:

- **It never runs on your server.** `GeneratedScreen` waits for mount before compiling, so the
  component is not evaluated during SSR next to the database pool.
- **The scope is the API.** The compiled function is called with exactly the names in that object;
  nothing else is in lexical reach, and there is no module registry to reach into. Adding a
  capability is a line in `scope.ts`.
- **Records move through the same typed path as everything else.** A screen names an object and a
  filter tree; `queryRecordsAction` compiles it with `planViewQuery` inside `withTenant`. Tenant
  isolation is where it always was — in Postgres.
- **Failure is a state, not a crash.** A screen that does not compile renders the message and the
  offending line; one that throws while drawing is caught by a boundary and takes only itself down.

The honest limit: this is not a sandbox against a hostile author. Generated code shares an origin
with the app, so it can reach what that signed-in user can already reach. It is the same trust
boundary as the agent having tools at all.

**Tailwind cannot see generated code.** It scans files at build time and a screen lives in the
database, so a class the model invents has no CSS behind it. The kit carries the styling; a curated
list of layout utilities is safelisted in `tailwind.config.ts`. Anything outside both silently does
nothing.

## The node vocabulary — what the agent composes

The agent builds screens by composing a tree, the way a page is composed out of HTML tags. There
is no screen inventory and no template: a board beside a form inside a panel is as valid as a
full-width table, because nothing decides in advance what a screen looks like.

`components/screens/ScreenRenderer.tsx` is the interpreter. One case per kind:

| Group | Kinds |
|---|---|
| Layout | `stack` `grid` `card` `section` `panel` `tabs` `tab` `divider` `spacer` |
| Content | `heading` `text` `metric` `badge` |
| Data | `table` `board` `list` `chart` |
| Input | `form` `record_detail` `search` `filters` `button` |

**The layout is unbounded; the vocabulary is not.** That is the whole design. A browser draws the
tags it knows and authors build anything out of them — same here. Adding a kind is a real change:
a case in the interpreter, a rule in `screenConfigSchema`, and a line in the `create_screen` tool
description. It is not a config edit.

Three rules hold the vocabulary together:

- **A style prop is a token, never a value.** `pad: "lg"`, not `padding: 23px`. A generated screen
  inherits the tenant's theme rather than fighting it — see `docs/DESIGN.md`.
- **A data node declares what it reads.** `query` and `aggregate` are typed and compiled by
  `lib/runtime/screen.ts`. The agent never writes a query; it says which object and which filters.
- **Nesting stops at eight.** Deeper than that is a layout nobody can reason about, including the
  agent that wrote it.

## The renderers below it — how a field draws

`FieldRenderer` is the one that matters: fourteen field types, two modes, and every data node
delegates to it. That is what keeps a currency formatted identically in a table cell, a board
card, and a form.

The screen-level renderers below (`TableView`, `KanbanView`, `RecordDetail`) predate the node
vocabulary and still serve `/views/[viewId]`. They are on their way out — generated screens
replace them — but they work, so they stay until nothing points at them.

All of them take config plus data and render. None contain business logic, and none know which
tenant they're serving.

---

### 1. `TableView`

The workhorse. Most users will spend most of their day here.

`props: { view: ViewConfig, records: Record[], total: number }`

Column widths resizable and persisted per user. Sort by clicking a header. Inline edit on
double-click for every field type. Row selection with shift-range. Sticky header, sticky first
column. Virtualised past 100 rows — do this from the start, retrofitting virtualisation into a
table with inline editing is miserable.

Empty state invites an action: "No deals yet. Add one, or import from a spreadsheet."

### 2. `KanbanView`

`props: { view: ViewConfig, pipeline: PipelineConfig, records: Record[] }`

Columns from pipeline stages. Drag between columns writes the stage field and fires the
`field_changed` trigger. Card content is the view's first three columns. Per-column count and
sum of the currency field when one is configured. Collapse a column. Lazy-load past 50 cards
per column.

### 3. `RecordDetail`

`props: { record: Record, object: ObjectConfig, layout: LayoutConfig }`

Side panel by default, full page on deep link. Fields grouped by config. Activity timeline
(email, notes, field changes, automation runs) as the right rail. Related records by relation
config. Everything inline-editable, saving on blur, with an optimistic update and a rollback on
failure.

### 4. `FormRenderer`

`props: { object: ObjectConfig, fields: FieldConfig[], values, onChange, onSubmit }`

Drives creation, editing, and public forms from the same config. Validation comes from the
field config — required, type, options — not from hand-written rules per form. Errors render
next to the field and say what to enter, not that something is invalid.

### 5. `FilterBar`

`props: { object: ObjectConfig, filters: FilterTree, onChange }`

A typed filter tree, not a query string: field, operator, value, joined by and/or with one
level of nesting. Operators come from the field type. Serialises into the view config so a
filtered view can be saved. This component is the reason the query resolver never has to parse
anything.

### 6. `FieldRenderer`

`props: { field: FieldConfig, value, mode: 'read' | 'edit' }`

One component, a switch over the fourteen field types, two modes. Every other renderer delegates
to this — that's what keeps a currency field formatted identically in a table cell, a card, a
detail panel, and a form. Adding a field type means adding one case here and one filter
predicate; if it means touching four components, the abstraction has leaked.

### 7. `AgentPanel`

`props: { conversation, onSend, pendingPatch }`

Docked right panel, collapsible, available on every screen. Streams the response. When the
agent produces a patch it renders `ConfigDiff` inline with confirm and discard. Shows the
tenant's remaining monthly budget when it drops below 20%.

Empty state carries three example prompts drawn from what this tenant hasn't configured yet —
that's how users learn what the agent can do. Nobody reads documentation for a chat box.

### 8. `ConfigDiff`

`props: { patch: ConfigPatch, impact: ImpactSummary }`

The trust surface of the entire product. Renders a patch in plain language: "Adds a Renewal date
field to Deals" — not JSON. Destructive changes are marked with the record count affected
("Removes Source from Contacts — 412 records have a value"). External effects (email, webhook)
are called out separately and confirmed separately.

Get this component right and users let the agent restructure their CRM. Get it wrong and they
never trust it twice.

### 9. `CommandPalette`

`props: { objects, views, actions }`

Cmd-K. Jump to a view, search records across objects, run an action, open the agent with a
prefilled prompt. In a keyboard product this is the primary navigation for power users, and
it's cheap to build once the config is queryable.

---

## Shared behaviour

Every renderer handles four states explicitly: loading (skeleton at the right dimensions, not a
spinner), empty (an invitation to act), error (what happened, what to do), and populated.

None of them fetch. Data arrives as props from a server component or a resolver hook. This is
what makes them testable against fixture config, which is the only sane way to verify
config-driven UI.

## The backend editor — why it is not a tenth renderer

`components/backend/` is the Data & workflows tab, and it breaks the rule above on purpose. The
nine renderers draw a *tenant's* CRM from config. The editor draws the config itself. It renders
nothing a customer sees, binds to no records, and would be the wrong thing to reach for when a
view is missing — so it is not a tenth renderer, it is the other side of the product.

Three panes, Shopify's shape:

| Pane | File | Shows |
|---|---|---|
| Structure | `StructureTree.tsx` | objects and their fields, screens and their node trees, workflows and their steps |
| Canvas | `DataObjectView.tsx`, `DataMap.tsx`, `ScreenView.tsx`, `WorkflowBuilder.tsx` | whatever is selected |
| Inspector | `Inspector.tsx` | its settings, as a form |

**The inspector is generated, not written.** `lib/config/controls.ts` declares which controls each
thing has — `nodeControls(kind)`, `fieldControls(type)`, `stepControls(type)`, `triggerControls(type)`
— and `Inspector` renders them. This is the same idea as Shopify's section `{% schema %}`: the
editor draws inputs from a declaration rather than growing a panel per thing. Adding a node kind
means a case in `nodeControls`, not a new component; option lists come off the schema's own const
arrays, so a control cannot offer a value validation would reject.

**Every edit is a patch.** `useConfigEdit` posts to `/api/agent/apply` — the same endpoint, the
same `parsePatch` and `commitPatches` the agent uses. A hand edit is versioned, diffable and
revertible exactly like a generated one, and both appear in `/settings/history`. Controls commit
on blur, drag-end or an explicit save, never per keystroke: a version should mean a change someone
intended.

## The rule

If you're about to build a view that isn't one of these, the answer is almost always to extend
a `ViewConfig` rather than write a tenth component. A "calendar view" is a table with a date
grouping. A "dashboard" is a saved set of filtered views. Resist. The ceiling is the feature.
