-- Every third-party OAuth grant, in one shape.
--
-- Which providers exist is configuration (lib/connectors/registry.ts), not
-- schema. Adding Slack or Notion later must not mean another migration.
--
-- The grant moves out of email_accounts and into here, so a mailbox row holds
-- only sync state and there is exactly one place a token can be revoked from.
-- This drops the token columns rather than copying them across: no deployment
-- has connected a mailbox yet, and a half-migrated token is worse than a
-- reconnect.

create table connections (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id) on delete cascade,
  user_id                 uuid not null references users(id) on delete cascade,
  provider                text not null,
  external_account_id     text not null,
  account_label           text not null,
  access_token_enc        text,
  refresh_token_enc       text,
  access_token_expires_at timestamptz,
  scopes                  jsonb not null default '[]'::jsonb,
  status                  text not null default 'active',
  connected_at            timestamptz not null default now()
);

create unique index connections_unique_idx
  on connections (tenant_id, user_id, provider, external_account_id);
create index connections_lookup_idx on connections (tenant_id, user_id, provider);

alter table connections enable row level security;
alter table connections force row level security;
create policy tenant_isolation on connections
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on connections to crm_app;

alter table email_accounts
  drop column refresh_token_enc,
  drop column access_token_enc,
  drop column access_token_expires_at,
  add column connection_id uuid not null references connections(id) on delete cascade;
