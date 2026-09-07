# AGENTS.md

Read this first, every session. Then read the doc in `docs/` that matches what you're about to do.

## What this is

A multi-tenant CRM that each customer configures by talking to an AI agent instead of hiring a
consultant. The agent writes **configuration**, never code and never customer data. A runtime
engine reads that configuration and renders the CRM.

Rename the package and the DB before the first commit — `crm-builder` is a placeholder.

## The three invariants

These are not preferences. If a change would break one of them, stop and say so instead of
working around it.

1. **The agent mutates config only.** It never writes customer records, never generates code,
   never executes SQL. Its entire surface is the tool list in `docs/AGENT-TOOLS.md`. Generated
   screens do not break this: a screen is a validated config tree an interpreter draws, not code
   that runs.
2. **Every config change is a validated, versioned, reversible patch.** No in-place edits. A
   change that cannot be rolled back is a bug.
3. **Tenant isolation is enforced in the database, not the application.** Postgres row-level
   security on every tenant-scoped table. An app-layer `where tenant_id = ?` is defence in
   depth, never the primary control.

## Stack

- Next.js 15 (App Router), TypeScript in strict mode
- Postgres 16, Drizzle ORM, RLS for tenancy
- pg-boss for background jobs (Postgres-backed — do not add Redis)
- Tailwind + shadcn/ui, components vendored into `components/ui`
- Zod for all runtime validation; config schema types are generated, never hand-written
- `@anthropic-ai/sdk` for the agent, using tool use

Do not add a dependency without asking. Especially: no ORM alternatives, no state management
library, no component library beyond shadcn, no Redis, no separate queue service.

## Layout

```
app/                    Next.js routes
  (marketing)/          public site — Overflow-style, see docs/DESIGN.md
  (app)/                the product — dense mode, see docs/DESIGN.md
components/
  ui/                   shadcn primitives, unmodified
  renderers/            the nine config-driven renderers — see docs/COMPONENTS.md
  agent/                chat panel, config diff viewer
lib/
  config/               schema, validation, patch application, versioning
  agent/                tool definitions, execution loop, guardrails
  runtime/              config -> query, config -> view resolution
  db/                   drizzle schema, migrations, RLS policies
docs/                   read these
```

## Working rules

**Before writing a renderer or any UI**: read `docs/COMPONENTS.md` and `docs/DESIGN.md`. The
agent composes screens from a node vocabulary, so the ceiling is no longer a list of screens —
it is that vocabulary plus the theme tokens. Layout is unbounded; the kinds are not. Adding a
node kind or a style token is a product decision: raise it, don't slip it in.

**Before touching the agent**: read `docs/AGENT-TOOLS.md`. Adding a tool is a design decision,
not an implementation detail.

**Before touching the data layer**: read `docs/ARCHITECTURE.md`. The generic `records` table is
a deliberate choice with a documented migration path; don't "fix" it by adding per-object tables.

**Tests**: config patch validation, patch/rollback round-trips, and RLS isolation are the three
areas that must have tests. A patch that applies but can't be reverted, or a query that leaks
across tenants, is the class of bug that kills the product. UI tests are optional for now.

**Migrations**: every schema change ships with an RLS policy for the new table if it is
tenant-scoped. A tenant-scoped table without a policy should fail CI.

**Cost**: every agent turn is metered per tenant. Never add an agent call to a hot path or a
render loop. Config editing is the only place the model runs.

## Style

Sentence case in all UI copy. Active voice on buttons — "Save changes", not "Submit". An action
keeps its name through the whole flow: a button that says "Publish" produces a toast that says
"Published". Errors say what happened and what to do; they don't apologise. Empty states invite
an action rather than describing absence.

## What v1 is not

No visual editor — the agent composes screens, nobody drags boxes. No templates of any kind:
every CRM is generated for the customer who asked for it. No reporting builder. No mobile app.
No public API.
Core objects are fixed (contacts, companies, deals, activities) — the agent customises them but
cannot yet create objects from nothing. One integration: Gmail or Outlook, two-way.

Scope creep here is the main risk to shipping. If a request falls outside this list, say so.
