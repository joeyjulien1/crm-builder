-- Saved generations: one row per completed build, holding the whole CRM
-- configuration as it was when the build finished. Opening a project writes
-- its config forward as a new version (like a rollback), so nothing is lost.
create table projects (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  prompt     text not null,
  config     jsonb not null,
  created_at timestamptz not null default now()
);

create index projects_tenant_created_idx on projects (tenant_id, created_at desc);

alter table projects enable row level security;
alter table projects force row level security;
create policy tenant_isolation on projects
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on projects to crm_app;
