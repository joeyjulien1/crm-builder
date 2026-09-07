-- One row per workflow that can be started by an inbound POST. The token is the
-- whole credential, so it is unguessable and unique; there is nothing else to
-- authenticate a caller with.
create table webhook_endpoints (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  automation_id text not null,
  token         text not null unique,
  created_at    timestamptz not null default now()
);

create unique index webhook_endpoints_automation_idx on webhook_endpoints (tenant_id, automation_id);

alter table webhook_endpoints enable row level security;
alter table webhook_endpoints force row level security;
create policy tenant_isolation on webhook_endpoints
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on webhook_endpoints to crm_app;

-- An inbound POST arrives with no session, so the tenant has to be resolved
-- from the token before a tenant-scoped transaction can be opened. That lookup
-- cannot go through RLS, so it is security definer and takes nothing but the
-- token — the same shape as app_user_memberships, and the second and last path
-- around the policies.
create or replace function app_webhook_tenant(p_token text)
returns table (tenant_id uuid, automation_id text)
language sql
security definer
set search_path = public
as $$
  select w.tenant_id, w.automation_id
  from webhook_endpoints w
  where w.token = p_token;
$$;
