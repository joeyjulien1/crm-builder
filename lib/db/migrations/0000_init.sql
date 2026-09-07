-- Foundation: identity, configuration, data, and row-level security.
--
-- Tenant isolation is enforced here, in the database. The app-layer
-- `where tenant_id = ?` is defence in depth and never the primary control.

create extension if not exists "pgcrypto";

-- The role the application connects as. It must not own these tables and must
-- not carry bypassrls, or the policies below are decorative.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_app') then
    create role crm_app login password 'crm_app' nobypassrls;
  end if;
end
$$;

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

create table users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  name           text not null,
  password_hash  text not null,
  created_at     timestamptz not null default now()
);

create table roles (
  key                text primary key,
  label              text not null,
  can_edit_config    boolean not null default false,
  can_manage_members boolean not null default false
);

insert into roles (key, label, can_edit_config, can_manage_members) values
  ('owner',  'Owner',  true,  true),
  ('admin',  'Admin',  true,  true),
  ('member', 'Member', false, false);

create table memberships (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  role_key   text not null references roles(key),
  created_at timestamptz not null default now()
);
create unique index memberships_tenant_user_idx on memberships (tenant_id, user_id);

create table sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  tenant_id  uuid references tenants(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);

/* -------------------------------------------------------------------------- */
/* Configuration — append-only. Never update or delete a row in this table.    */
/* -------------------------------------------------------------------------- */

create table config_versions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  version    integer not null,
  parent_id  uuid,
  config     jsonb not null,
  patch      jsonb not null,
  author     text not null,
  summary    text not null,
  created_at timestamptz not null default now()
);
create unique index config_versions_tenant_version_idx on config_versions (tenant_id, version);
create index config_versions_tenant_created_idx on config_versions (tenant_id, created_at);

-- Append-only is a database guarantee, not a convention the app remembers.
-- Delete is left alone so that deleting a tenant can cascade; mutation is the
-- failure mode that silently rewrites history, and that is what this blocks.
create or replace function reject_config_version_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'config_versions is append-only; write a new version instead';
end;
$$;

create trigger config_versions_append_only
  before update on config_versions
  for each row execute function reject_config_version_mutation();

/* -------------------------------------------------------------------------- */
/* Data                                                                        */
/* -------------------------------------------------------------------------- */

create table records (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  object_key text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index records_tenant_object_updated_idx on records (tenant_id, object_key, updated_at desc);
create index records_data_gin_idx on records using gin (data);

create table record_links (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  from_id      uuid not null references records(id) on delete cascade,
  to_id        uuid not null references records(id) on delete cascade,
  relation_key text not null
);
create index record_links_from_idx on record_links (tenant_id, from_id, relation_key);
create index record_links_to_idx on record_links (tenant_id, to_id, relation_key);
create unique index record_links_unique_idx on record_links (tenant_id, from_id, to_id, relation_key);

/* -------------------------------------------------------------------------- */
/* Agent metering and failure log                                              */
/* -------------------------------------------------------------------------- */

create table agent_turns (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  user_id       uuid references users(id) on delete set null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_cents    integer not null default 0,
  model         text not null,
  produced_patch boolean not null default false,
  created_at    timestamptz not null default now()
);
create index agent_turns_tenant_created_idx on agent_turns (tenant_id, created_at);

create table agent_failures (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  kind       text not null,
  prompt     text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index agent_failures_tenant_created_idx on agent_failures (tenant_id, created_at);

create table token_budgets (
  tenant_id           uuid primary key references tenants(id) on delete cascade,
  monthly_token_limit integer not null default 2000000,
  period_start        timestamptz not null default now(),
  tokens_used         integer not null default 0
);

/* -------------------------------------------------------------------------- */
/* Automations                                                                 */
/* -------------------------------------------------------------------------- */

create table automation_runs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  automation_id   text not null,
  config_version  integer not null,
  depth           integer not null default 0,
  status          text not null,
  idempotency_key text not null,
  input           jsonb not null default '{}'::jsonb,
  output          jsonb not null default '{}'::jsonb,
  error           text,
  created_at      timestamptz not null default now()
);
create unique index automation_runs_idem_idx on automation_runs (tenant_id, idempotency_key);
create index automation_runs_tenant_created_idx on automation_runs (tenant_id, created_at);

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

create table files (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  filename   text not null,
  contents   text not null,
  created_at timestamptz not null default now()
);
create index files_tenant_idx on files (tenant_id);

create table import_jobs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  file_id    uuid not null references files(id) on delete cascade,
  object_key text not null,
  mapping    jsonb not null,
  dedupe_key text,
  status     text not null default 'queued',
  processed  integer not null default 0,
  created    integer not null default 0,
  updated    integer not null default 0,
  skipped    integer not null default 0,
  total      integer not null default 0,
  error      text,
  created_at timestamptz not null default now()
);
create index import_jobs_tenant_idx on import_jobs (tenant_id, created_at);

/* -------------------------------------------------------------------------- */
/* Email                                                                       */
/* -------------------------------------------------------------------------- */

create table email_accounts (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  user_id                  uuid not null references users(id) on delete cascade,
  provider                 text not null,
  address                  text not null,
  refresh_token_enc        text not null,
  access_token_enc         text,
  access_token_expires_at  timestamptz,
  history_id               text,
  store_bodies             boolean not null default false,
  backfill_cursor          text,
  backfill_done            boolean not null default false,
  created_at               timestamptz not null default now()
);
create unique index email_accounts_unique_idx on email_accounts (tenant_id, user_id, address);

create table email_messages (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  account_id          uuid not null references email_accounts(id) on delete cascade,
  provider_message_id text not null,
  thread_id           text,
  subject             text,
  from_address        text not null,
  to_addresses        jsonb not null default '[]'::jsonb,
  sent_at             timestamptz not null,
  body                text,
  created_at          timestamptz not null default now()
);
create unique index email_messages_provider_idx on email_messages (tenant_id, account_id, provider_message_id);
create index email_messages_tenant_sent_idx on email_messages (tenant_id, sent_at);

create table email_links (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  message_id uuid not null references email_messages(id) on delete cascade,
  record_id  uuid not null references records(id) on delete cascade,
  matched_by text not null
);
create unique index email_links_unique_idx on email_links (tenant_id, message_id, record_id);
create index email_links_record_idx on email_links (tenant_id, record_id);

/* -------------------------------------------------------------------------- */
/* Per-user preferences and the activity timeline                              */
/* -------------------------------------------------------------------------- */

create table view_prefs (
  tenant_id     uuid not null references tenants(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  view_id       text not null,
  column_widths jsonb not null default '{}'::jsonb,
  primary key (tenant_id, user_id, view_id)
);

create table activity_entries (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  record_id  uuid not null references records(id) on delete cascade,
  kind       text not null,
  actor      text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_entries_record_idx on activity_entries (tenant_id, record_id, created_at);

/* -------------------------------------------------------------------------- */
/* Row-level security                                                          */
/*                                                                             */
/* current_setting(..., true) returns null when unset, and `tenant_id = null`  */
/* filters every row — an unset tenant sees nothing rather than erroring.      */
/* force is what makes the policy apply to the table owner too.                */
/* -------------------------------------------------------------------------- */

create or replace function current_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;

do $$
declare
  t text;
  tenant_scoped text[] := array[
    'memberships', 'config_versions', 'records', 'record_links',
    'agent_turns', 'agent_failures', 'token_budgets', 'automation_runs',
    'files', 'import_jobs', 'email_accounts', 'email_messages',
    'email_links', 'view_prefs', 'activity_entries'
  ];
begin
  foreach t in array tenant_scoped loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())',
      t
    );
  end loop;
end
$$;

-- The tenants row itself is scoped by its own id.
alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenant_isolation on tenants
  using (id = current_tenant_id())
  with check (id = current_tenant_id());

-- Login happens before a tenant is chosen, so this one lookup has to cross
-- tenants. It is security definer, owned by the migrating superuser, and takes
-- only a user id — the single audited path around RLS.
create or replace function app_user_memberships(p_user_id uuid)
returns table (tenant_id uuid, tenant_name text, tenant_slug text, role_key text)
language sql
security definer
set search_path = public
as $$
  select t.id, t.name, t.slug, m.role_key
  from memberships m
  join tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id
  order by t.name;
$$;

/* -------------------------------------------------------------------------- */
/* Grants                                                                      */
/* -------------------------------------------------------------------------- */

-- pg-boss manages its own schema and checks for it on every start.
create schema if not exists pgboss;
grant usage, create on schema pgboss to crm_app;
do $$
begin
  execute format('grant create on database %I to crm_app', current_database());
end
$$;
grant usage on schema public to crm_app;
grant select, insert, update, delete on all tables in schema public to crm_app;
grant execute on function app_user_memberships(uuid) to crm_app;
grant execute on function current_tenant_id() to crm_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to crm_app;
