# Build order

## Context

The original twelve-week plan is done and superseded. Foundation, config layer, runtime, the
agent, and screens all exist and work. That plan ended at "a config-driven CRM with an agent";
this one starts from what the product is actually for.

The product is the workflow an agency runs when it sells a bespoke CRM: vibe-code a demo in
front of the customer, shape the UI to their trade, hand over something that is theirs, and add
an AI agent later as a paid extra. Three capabilities have to be genuinely good for that to
work without the agency in the middle:

- **A database you build visually** — nodes and wires, like Shopify's data model crossed with
  Unreal blueprints.
- **Vibe coding** — describe the CRM, watch it appear. Mostly built.
- **Design editing** — direct manipulation, like Figma.

The blocker today is the third one, and it is a self-inflicted wound. Every generated CRM looks
the same. Not similar — the same.

## The diagnosis

Measured, not estimated:

| | Today |
|---|---|
| Values that differ between two CRMs | **6** (`mode`, `accent`, `neutral`, `radius`, `density`, `font`) |
| Themeable CSS custom properties | **18**, all colour + 3 radii + 1 font family |
| Node kinds that honour `style` | **10 of 22** — every data node ignores it |
| Style props available | **11**, all 5-value enums |
| Raw Tailwind colours outside the theme | **283** across 15 files |
| Tenants that boot identical | **all of them** — `default.ts` ships no theme |

Three compounding causes:

1. **The theme is a menu, not a palette.** `lib/config/theme.ts` offers four grey ramps that are
   near-identical in value — every light mode is `#ffffff` on `#ffffff`, differing by one or two
   hex digits. Picking `stone` over `zinc` is imperceptible.
2. **Shape lives in TSX, not config.** ~60 hardcoded classNames in
   `components/screens/ScreenRenderer.tsx` fix the shape of every card, table, board column,
   panel, metric and tab bar. A card is `rounded border border-edge bg-surface-raised`,
   unconditionally. The agent picks *which* nodes and *where* — never what they look like.
3. **The chrome is outside the system.** `AppShell` is `bg-[#000000] text-zinc-100`,
   `FigmaCanvasFrame` is black with a dot grid, and `DynamicCrmCanvas` runs a *second*,
   competing light/dark switch off `brand.theme` on raw slate/zinc. The CRM's own header — the
   most brand-defining element on screen — cannot be themed at all.

The closed sets were a deliberate call, written up in `docs/DESIGN.md` as the only way to
guarantee a readable CRM. That is the right trade for a config tool and the wrong one for a
product whose value *is* bespoke design. It is being reversed on purpose.

**The replacement principle: variety comes from generation, safety comes from validation.**
Not from a short list. The agent generates a palette per customer — pick a base hue, derive
surfaces at controlled lightness steps — and a contrast validator rejects unreadable
combinations, the same way the impossible-filter check rejects a metric that would silently read
zero. `luminance()` and `shift()` already exist in `theme.ts`; contrast ratio is ~15 more lines,
no new dependency.

---

## Phase 1 — Make two CRMs look unrelated — **done**

Measured on two CRMs generated back to back from the same empty workspace:
**45 of 51 CSS variables differ**, against six values before. Both palettes
passed the contrast validator.

The whole complaint lived here, and everything after it builds on the same data.

**1.1 Widen the token layer.** `themeConfigSchema` in `lib/config/schema.ts` grows from six
scalars to token families. Colours become generated values, not ramp names.

```
theme.colors    surface, sunken, raised, hover, text{primary,secondary,muted},
                border{subtle,strong}, accent, accentFg, danger, success, warning
theme.type       fontBody, fontDisplay, scaleRatio, baseSize, weights, tracking
theme.space      unit, scale
theme.shape      radius{sm,md,lg}, borderWidth, focusRing{width,offset}
theme.shadow     card, panel, overlay
theme.motion     ease, durationFast, duration
```

Every one of these already has a consumer in `app/globals.css` or needs a one-line addition to
`tailwind.config.ts`. Note the ones currently defined and never read — `--border-width` — and
the ones hardcoded for everyone: `--danger`/`--success`/`--warning`, the `2px/2px` focus ring at
`globals.css:211`, and all of `--ease`/`--dur`.

**1.2 Add component variants.** A new `theme.components` block. This is what makes two CRMs feel
like different products rather than the same product repainted.

| Component | Variants |
|---|---|
| `table` | bordered, striped, flush, cards |
| `card` | outlined, elevated, flat, tinted |
| `button` | solid, outline, ghost, pill |
| `badge` | solid, outline, dot |
| `tabs` | underline, pill, segmented |
| `input` | outlined, filled, underlined |

`components/ui/button.tsx` is the only `cva` component in the repo and already has the right
shape — extend that pattern rather than inventing one. `cn` (clsx + tailwind-merge) means a
later `className` wins, so the mechanism for overriding from outside already works; it is simply
not reachable from config.

**1.3 Make all 22 node kinds honour `style`.** This is the single biggest lever. Twelve kinds —
`table`, `board`, `list`, `chart`, `form`, `record_detail`, `button`, `search`, `filters`,
`badge`, `divider`, `spacer` — currently discard every style prop. Widen `uiStyleSchema` too:
`radius`, `shadow`, `width`, `align`/`justify` split, `textAlign`, `variant`.

**1.4 De-hardcode `ScreenRenderer`.** Each hardcoded class becomes a themed default. Specific
offenders worth naming because they are visible on every screen:

- `:159` every table cell is `text-xs`, always
- `:211` board columns fixed at 256px; `:468` panels fixed at 288px
- `:332` a metric value is always `text-lg semibold` — a KPI can never be a hero number
- `:458` section headings are always ALL-CAPS tracked-out `text-xs`, which `docs/DESIGN.md:172`
  explicitly forbids
- `:490` `spacer` is always exactly 12px
- `:494` every `heading` is `text-lg` — there is no h1/h2/h3
- `:562` every button is small and secondary — no primary CTA is expressible
- `:101` `style.border` always drags `rounded` and `border-edge` along with it

**1.5 Bring the chrome inside the theme.** `AppShell.tsx:86`, `FigmaCanvasFrame`, and
`DynamicCrmCanvas`. Delete the competing `brand.theme` / `brand.layoutStyle` switch — nine
`layoutStyle` values currently select a lucide icon and nothing else.

**1.6 Seed a generated theme in `lib/config/default.ts`,** so a new tenant does not boot into
the same dark/`#4f63b5`/zinc/compact/system as every other tenant.

**1.7 Real typography.** The "system stacks only" rule in `theme.ts:91` caps identity at
"generic sans vs generic serif". Add a curated web font set through `next/font` (self-hosted, so
no FOUT and no runtime dependency on Google).

**1.8 A theme editor for humans.** `BrandCustomizerModal` currently edits three strings and pins
`accentColor` to `#ffffff`. There is no UI anywhere for the actual theme — it is agent-only.

---

## Phase 2 — Figma-style direct editing

Both editors write the same tree, which is what makes this cheap.

- **Give `UiNode` a stable `id`.** Nodes are addressed by tree path (`root.children.2`) today;
  selection has to survive reordering.
- **Selection and an inspector** on the screen canvas: click any node, edit its style and props.
- **Write through `/api/agent/apply`.** It takes `{patches}`, validates each with `parsePatch`,
  and commits via `commitPatches` — it is *not* agent-specific despite the route name. Direct
  edits become `update_screen` patches, so they are versioned, diffable and reversible for free,
  and undo is the rollback that already exists.
- Drag to reorder, drag to resize, keyboard nudge.

---

## Phase 3 — The database as a blueprint

**3.1 Delete the fake surface first — complete.** The backend is now a configuration explorer:

- Workflows render their saved trigger, conditions, actions, and enabled state in execution order.
- Data objects render their actual fields, relationships, views, screens, and pipelines.
- Screens render only the component kinds and data sources present in their saved tree.
- The fake per-object SQL, RLS inspector, Supabase node, hardcoded integration steps, pulsing traffic,
  freeform dragging, zoom controls, and minimap have been removed.
- Workflow status is the first direct control. It writes a validated, versioned
  `set_automation_enabled` patch and reports a save failure in place.

**3.2 Make the backend an editor — done, and not as a canvas.**

The node-and-wire canvas was the wrong shape for the job. What people need from the backend is to
*find* a thing and change it, which a tree plus an inspector does in two clicks and a graph makes
you trace. `components/blueprints/` is gone; `components/backend/` is the Shopify-customize shape:
structure on the left, the selection in the middle, its settings on the right.

- `onApplyPatches` is implemented in `AppShell` against `/api/agent/apply`, and every control in
  every pane goes through `useConfigEdit`. Direct edits carry `author: "user"`, so change history
  distinguishes them from the agent's.
- Fields are editable in place: rename, required, help text, options → `update_field`; drag →
  `reorder_fields`; add → `add_field`; delete → `remove_field`, behind a confirm that shows the
  real affected-record count from `/api/config/impact`.
- Screens: the node tree is the left rail, a wireframe is the canvas, and `nodeControls` drives the
  inspector. Add, remove and reorder blocks all commit one `update_screen`.
- The pin geometry problem is gone with the pins. `DataMap.tsx` draws the entity map with a layout
  engine that measures its own handles.

Still not done here: relations are read-only in the map (dragging one into existence needs a
`create_relation` gesture and drop validation), and node positions are not persisted per user —
the `view_prefs` pattern in `saveColumnWidthsAction` (`app/(app)/actions.ts:124`) is still the
precedent when they should be.

**3.3 Custom objects.** A supermarket should not call its products "companies".

The database does not block this: `records.object_key` is plain `text not null` with no CHECK
constraint, chosen deliberately in `docs/ARCHITECTURE.md` so config drives the model without
DDL. The block is one enum:

```ts
// lib/config/schema.ts:38
export const OBJECT_KEYS = ["contact", "company", "deal", "activity"] as const;
```

Open it to the validated `identifier` regex, add `create_object`/`delete_object` patch ops and
agent tools, and audit the consumers — `objectKeySchema` appears in only four files. No
migration. Watch the places that assume `contact` exists: email matching, `lib/runtime/seed.ts`,
and the hardcoded positions/icons in `blueprint-utils.ts:54`.

---

## Phase 4 — Connectors, agents and messaging

The OAuth layer is genuinely good — eight providers, AES-256-GCM tokens, real refresh with
expiry skew, revoke on disconnect, and a per-provider state cookie. Adding an OAuth2 provider
really is close to a config entry. Three things it cannot do yet:

- **Non-OAuth credentials — done.** `ProviderConfig` carries a `kind`, an `api_key` provider
  declares the fields its form asks for, and the values go into `connections.access_token_enc`
  encrypted as one blob. No migration, as expected. Twilio is the first one.
- **Outbound calls — done.** `lib/connectors/call.ts` is the generic "call provider X with the
  workspace's connection": it finds the connection, builds the headers, times out, and turns a
  refusal into a sentence. A provider's own quirks stay in the registry — Slack answering 200 for
  a failed post is a `checkResponse` entry, not a branch in the call layer. `lib/email/gmail.ts`
  still hand-rolls its own wrapper and should move onto this.
- **SMS and Slack as workflow steps — done.** Both are steps in the union, both are in
  `EXTERNAL_EFFECT_ACTIONS`, and both refuse clearly when the account is not connected.
- **Inbound webhooks and schedules — done.** A `webhook_received` workflow gets an endpoint whose
  token is its only credential; `app_webhook_tenant` is the second and last security-definer path
  around RLS. A `schedule` trigger fires on the daily sweep, once per matching record, capped at
  1000 records.

**Make custom agents real.** `config.customAgents` stores a name, role and instructions that
*nothing executes*. It is the "add an AI agent later, billed monthly" product, currently
decorative. Either implement it against the existing agent loop or delete it.

**Per-tenant API keys.** `resolveProvider()` reads server env vars, so every tenant shares one
key. The paid-extra model needs keys stored per tenant, encrypted like connector tokens.

---

## Phase 5 — Handover and billing

None of this exists. There is a dead `onDeployWebsite` prop that never renders, and an
unreachable subscription modal whose "Start 14-Day Free Trial" button does
`setSubscribed(true)` with no Stripe anywhere.

- **Export**: config + data out. `lib/import/csv.ts` only parses; there is no serializer and no
  `text/csv` response in the codebase. Import is currently one-way.
- **Deploy**: provision the customer's own Supabase + Vercel from their connected accounts.
- **Billing**: `token_budgets` and `agent_turns` already meter tokens and cost per tenant.
  Nothing rolls that up, and no settings UI exists to raise a limit — the budget error text
  already promises one.

---

## Bugs found while mapping this

Cheap, real, and worth doing before the phase they belong to:

| Bug | Where |
|---|---|
| ~~Automation email cannot work~~ — fixed; the registry asks for `gmail.send` | `lib/connectors/registry.ts` |
| **Virtualiser desync.** `ROW_HEIGHT = 34` is hardcoded in JS while `--row-h` becomes 44px at comfortable density. Rows overlap. | `components/renderers/TableView.tsx:20` |
| `chartType: "donut"` validates and renders a bar chart — there is no donut branch | `ScreenRenderer.tsx:302` |
| `selectOption.color` is in the schema and never rendered; `Badge` has no filled variant | `components/ui/badge.tsx` |
| ~~Queued jobs only advance when a signed-in user loads a view~~ — fixed; `vercel.json` drains every five minutes and sweeps daily, both authenticated with `CRON_SECRET`. `dispatchDueDates` had never been called by anything, so `date_reached` had never fired once. | `vercel.json`, `app/api/jobs/sweep` |
| `brand.kpis` still stores invented metric strings; `brand.accentColor` is never read as CSS | `lib/config/schema.ts:291` |
| Dead code: `onDeployWebsite`, the fake Stripe modal, duplicated `useEffect`, unused imports | `AppShell.tsx`, `BlueprintCanvas.tsx:38,86` |

---

## Verification

Each phase ships behind the same checks the repo already enforces:

- `npm run test` — patch/rollback round-trips and RLS isolation are the two suites that must
  never go red. Phase 1 adds contrast-validator tests; phase 3 adds `create_object` round-trips.
- `NEXT_DIST_DIR=.next-verify npx next build` — never plain `next build`, which overwrites a
  running dev server's chunks.
- **The real test is comparative.** Generate a dental clinic and a luxury brokerage from the same
  empty workspace and put the screenshots side by side. If they share a visual language, phase 1
  is not done.

## Two things to track from day one

Unchanged from the original plan, and still right.

**Cost per tenant.** If the median tenant costs more than ~15% of their subscription in
inference, the pricing model is wrong.

**Where the agent fails.** `agent_failures` already logs every patch that failed validation.
That log is the roadmap — it says what people expect the agent to do and it cannot.
