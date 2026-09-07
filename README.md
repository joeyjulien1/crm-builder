# crm

A multi-tenant CRM that each customer configures by talking to an AI agent instead of hiring a
consultant. The agent writes **configuration**, never code and never customer data. A runtime engine
reads that configuration and renders the CRM.

## Run it

Requires Node 22 and Postgres 16.

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL and DATABASE_ADMIN_URL
createdb crm
npm run db:migrate            # creates the schema, the crm_app role, and every RLS policy
npm run dev                   # the app
npm run worker                # background jobs, in a second terminal
```

The app connects as `crm_app`, a role without `bypassrls`. Migrations connect as the owner. If you
point both at the same superuser, the isolation tests still pass — `force row level security` binds
the owner too — but you have given up a layer of defence, so don't.

```bash
npm test           # config patches, rollback round-trips, and RLS isolation
npm run typecheck
```

## Deploying

The app connects as a role **without `bypassrls`**. This is not a detail: on a managed Postgres the
default superuser usually carries `bypassrls`, and connecting as it turns every policy in this
repository into decoration — silently, and invisibly until you have two tenants. Check it:

```sql
select rolname, rolbypassrls from pg_roles where rolname = current_user;
```

If your provider publishes the `public` schema over an HTTP API (Supabase does, via PostgREST), the
`users` and `sessions` tables — which carry no RLS, because they are not tenant-scoped — are exposed
to whatever role that API authenticates as. Revoke it; this app never uses PostgREST:

```sql
revoke all on all tables in schema public from anon, authenticated;
revoke usage on schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
revoke all on function app_user_memberships(uuid) from public, anon, authenticated;
```

Serverless needs the transaction-mode connection pooler, which works here because `app.tenant_id` is
set with `set_config(..., true)` — transaction-scoped, not session-scoped. Background jobs have no
process to run in, so see "Running jobs where there is no process" in `docs/ARCHITECTURE.md`.

Managed providers usually present a certificate signed by their own CA, which Node does not trust.
Put that CA in `DATABASE_CA_CERT` (Supabase: Settings → Database → SSL configuration) and the
connection is encrypted *and* authenticated. `DATABASE_SSL_NO_VERIFY=1` also connects, but it
accepts any certificate offered, so a machine-in-the-middle between the app and the database would
go unnoticed. Prefer the CA. `/api/health` reports which of the two is in force.

`DATABASE_URL` is the only variable the app needs to run. Session tokens are random and stored
hashed, so there is no signing secret. `ENCRYPTION_KEY` (32 bytes, base64) is required only for
email sync, `ANTHROPIC_API_KEY` only for the agent, and the three `GOOGLE_*` variables only for
Gmail.

`GET /api/health` reports which of those are set and, when the database is unreachable, why —
including whether the connected role can bypass RLS, which is the one thing that must never be
true in production.

## The three invariants

1. The agent mutates config only. Its entire surface is the tool list in `docs/AGENT-TOOLS.md`.
2. Every config change is a validated, versioned, reversible patch.
3. Tenant isolation is enforced in the database, not the application.

`lib/db/rls.test.ts` fails if a policy is removed, and fails if a new table carries `tenant_id`
without being declared tenant-scoped.

## Layout

```
app/
  (marketing)/          public site — site density
  (app)/                the product — dense mode
components/
  ui/                   shadcn primitives, unmodified
  renderers/            the nine config-driven renderers
  agent/                chat panel, config diff viewer
lib/
  config/               schema, validation, patch application, versioning
  agent/                tool definitions, execution loop, guardrails
  runtime/              config -> query, config -> view resolution
  automations/          trigger evaluation and action execution
  import/               spreadsheet mapping and background import
  email/                Gmail OAuth, sync, record matching
  db/                   schema, migrations, RLS policies
  jobs/                 pg-boss queue and worker entrypoint
docs/                   read these
```

## Keep the docs honest

When a decision changes, change the doc in the same commit as the code. These files are only useful
if they describe what's actually true; a stale `COMPONENTS.md` is worse than no `COMPONENTS.md`,
because the agent will build against it confidently.

## Files

| File | Read it when |
|---|---|
| `CLAUDE.md` | every session |
| `docs/ARCHITECTURE.md` | touching data, tenancy, config versioning, sync |
| `docs/AGENT-TOOLS.md` | touching the agent |
| `docs/DESIGN.md` | touching anything visual |
| `docs/COMPONENTS.md` | building or changing a renderer |
| `docs/ROADMAP.md` | starting a milestone |

## What is verified, and what isn't

`npm test` covers config patches and rollback round-trips, RLS isolation, filter compilation, field
coercion, the agent's tool surface, budget enforcement, automation depth and idempotency, and
import. A browser pass covers sign-up, the table, inline editing, filtering, the board, the command
palette, the agent panel, record detail, history, and an import running to completion.

Two paths have no automated coverage because they need credentials this repo does not carry:

- **The agent's model round-trip.** Tool definitions, patch staging, validation retry, budget, and
  the diff are all tested; the `messages.create` call itself has never run. Set `ANTHROPIC_API_KEY`
  and ask it for a renewal date field to close that gap.
- **Gmail sync.** OAuth, backfill, incremental sync, and matching are written against Gmail's REST
  API but have not been run against a real mailbox. Set the three `GOOGLE_*` variables first.

## Still to do

`docs/DESIGN.md` ships placeholder brand tokens. Pull the real computed colour ramp, font stack,
radius, and border values and replace the brand block in `app/globals.css` — everything else in the
design system reads through the semantic layer, so that block is the only edit.

`date_reached` automations have a sweep (`dispatchDueDates`) but nothing calls it yet; it needs a
scheduled job. Billing, onboarding email, error monitoring, and a status page — the rest of
milestone 9 — are not built.
