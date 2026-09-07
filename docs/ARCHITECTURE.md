# Architecture

## The shape

```
chat  ->  agent  ->  tools  ->  config patch  ->  validate  ->  diff  ->  apply
                                                                            |
                                                                            v
                                                        config version (immutable)
                                                                            |
                                                                            v
                                              runtime engine  ->  queries + views
                                                                            |
                                                                            v
                                                                  customer data
```

The agent's output is a patch against configuration. It never reaches the bottom of this
diagram. That separation is what makes the product safe enough to sell.

## Tenancy

Every tenant-scoped table carries `tenant_id uuid not null` and has an RLS policy:

```sql
alter table records enable row level security;
alter table records force row level security;

create policy tenant_isolation on records
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());
```

`current_tenant_id()` is `nullif(current_setting('app.tenant_id', true), '')::uuid`. The two-argument
form returns null instead of raising when the setting is missing, and `tenant_id = null` matches no
rows — an unset tenant sees nothing rather than erroring, which is the direction you want to fail in.
`force` is what makes the policy bind the table owner too, so the guarantee does not depend on which
role happens to be connected. `with check` is what stops a tenant writing a row stamped with someone
else's id.

Login happens before a tenant is chosen, so one `security definer` function, `app_user_memberships`,
takes a user id and returns their workspaces. That is the single audited path around RLS; everything
else goes through `withTenant`.

The app sets `app.tenant_id` once per request, inside the transaction, from the session — never
from a request parameter, header, or anything the client controls. Get this wrong once and you
have a cross-tenant data leak, which is an unrecoverable event for a CRM company.

Connection pooling caveat: `set_config` must be transaction-scoped (`set_config(..., true)`),
otherwise a pooled connection carries one tenant's setting into another tenant's request. Wrap
every query in a transaction that sets the tenant first. Put this in one helper and use it
everywhere; do not open raw connections.

## Data model

Three groups of tables.

**Identity**: `tenants`, `users`, `memberships` (user + tenant + role), `roles`.

**Configuration**: `config_versions` — append-only.

```
config_versions
  id            uuid pk
  tenant_id     uuid
  version       int          -- monotonic per tenant
  parent_id     uuid null    -- the version this was derived from
  config        jsonb        -- the full resolved config, not a delta
  patch         jsonb        -- the delta that produced it, for display
  author        text         -- 'agent' | user id
  summary       text         -- one line, shown in history
  created_at    timestamptz
```

Storing the full resolved config per version rather than a chain of deltas costs a few KB per
edit and buys you instant rollback, cheap diffing, and no replay bugs. Take the trade.

Rollback is: read version N, write it as a new version N+2 with a note. Never delete or mutate
a version row.

**Data**: one generic table.

```
records
  id            uuid pk
  tenant_id     uuid
  object_key    text         -- 'contact' | 'company' | 'deal' | 'activity'
  data          jsonb        -- field values keyed by field id from config
  created_at    timestamptz
  updated_at    timestamptz
  deleted_at    timestamptz null

record_links
  id, tenant_id, from_id, to_id, relation_key
```

Index: `(tenant_id, object_key, updated_at desc)` for list views, plus a GIN index on `data`
for filtering.

**Why generic**: the whole product is config-driven. Per-object tables would mean the agent
triggers DDL, which reintroduces exactly the risk the config layer exists to remove.

**The cost**: no foreign key integrity on relations, and filtering on a jsonb field is slower
than a real column. At your v1 scale — hundreds of tenants, tens of thousands of records each —
Postgres handles this without complaint.

**The escape hatch, when you need it**: promote hot fields to generated columns
(`alter table records add column deal_amount numeric generated always as ((data->>'amount')::numeric) stored`)
and index those. This is additive and doesn't change the config contract. Do it when a query
gets slow, not before.

## The runtime engine

Three resolvers, all pure functions of config plus input:

1. **Query resolver** — view config plus filter state to a Drizzle query. Filters compile to
   jsonb predicates. Never string-concatenate SQL; the filter tree is a typed structure that
   compiles through the query builder.
2. **View resolver** — view config to a renderer choice plus props. The output must be one of
   the nine components in `docs/COMPONENTS.md`.
3. **Field resolver** — field config to the right input and display component per type.

If any of these needs a special case for a specific tenant, the config schema is missing
something. Fix the schema, not the resolver.

## Automations

Trigger, condition, action. Stored in config, executed by pg-boss workers.

Triggers: record created, record updated, field changed, date reached, form submitted.
Actions: set field, create record, create task, send email, call webhook.

Three rules that prevent the classic failure modes:
- Every run is logged with inputs, outputs, and the config version it ran under.
- Depth limit of 5 on automation-triggered automations, then hard stop with an error surfaced
  to the tenant. Without this, two automations that update each other will run forever.
- Actions are idempotent by key, so a retried job doesn't send an email twice.

## Running jobs where there is no process

`npm run worker` is the worker: a process that sits there and consumes. A serverless host has no
such process, so `POST /api/jobs/drain` runs the same handlers on the same queues on demand, and the
client calls it while it polls a job's progress.

Only the wake-up changes. The job is still queued, still logged, still idempotent, still retried,
and still runs outside the request that created it — an import of twenty thousand rows is not done
inside the request that uploaded the file. Where a real worker is running it simply takes the job
first; `fetch` is atomic, so the two cannot both run it.

The honest limit: a single job that outlives the platform's function timeout will be retried rather
than finished. Past that size, run a worker process.

## Email and calendar sync

Budget three to four weeks. It is the single largest piece of v1 outside the runtime, and it's
where daily usage lives — a CRM that doesn't see your mail is a spreadsheet with opinions.

- OAuth per user, not per tenant. Tokens encrypted at rest.
- Gmail: watch + history API. Outlook: Graph subscriptions with renewal jobs.
- Match messages to records by email address, then by domain for companies.
- Store message metadata and a pointer, plus body only where the user opted in. Do not
  indiscriminately copy every mailbox into your database — it's a liability and a cost centre.
- Backfill is a separate, resumable job from the live subscription. Treat them independently.

## Agent guardrails

- Tool calls only. No code generation, no SQL, no shell.
- Every patch is validated against the JSON schema before it is shown to the user.
- Every patch is shown as a human-readable diff and applied only on explicit confirmation.
- Destructive patches (removing a field that holds data, deleting a pipeline stage in use) are
  flagged in the diff with the record count affected.
- Per-tenant monthly token budget, enforced before the call. At 80% consumed, warn in the UI.
- The agent reads config and record *counts*. It does not read record contents, except during
  import mapping where the user has explicitly handed over a file.
