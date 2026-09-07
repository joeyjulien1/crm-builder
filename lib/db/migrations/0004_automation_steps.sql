-- Where a run suspended by a delay step resumes. Null for a run that never
-- waited. See lib/automations/steps.ts for the encoding.
alter table automation_runs add column if not exists cursor jsonb;

-- Runs already carry an RLS policy from 0000_init.sql; a new column on an
-- existing table inherits it, so there is nothing to add here.
