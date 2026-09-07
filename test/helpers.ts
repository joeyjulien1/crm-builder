import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createAdminPool } from "@/lib/db/client";
import { defaultConfig } from "@/lib/config/default";
import type { Config } from "@/lib/config/types";

export interface SeededTenant {
  id: string;
  name: string;
}

/**
 * Test fixtures are written through the admin (superuser) pool, which bypasses
 * RLS. Everything under test reads through the application pool, which does not.
 */
export function adminPool(): Pool {
  return createAdminPool();
}

export async function createTenant(pool: Pool, name: string): Promise<SeededTenant> {
  const id = randomUUID();
  await pool.query("insert into tenants (id, name, slug) values ($1, $2, $3)", [
    id,
    name,
    `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(0, 8)}`,
  ]);
  return { id, name };
}

export async function createUser(pool: Pool, email: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "insert into users (id, email, name, password_hash) values ($1, $2, $3, $4)",
    [id, email, email.split("@")[0], "not-a-real-hash"],
  );
  return id;
}

export async function seedRecord(
  pool: Pool,
  tenantId: string,
  objectKey: string,
  data: Record<string, unknown>,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "insert into records (id, tenant_id, object_key, data) values ($1, $2, $3, $4)",
    [id, tenantId, objectKey, JSON.stringify(data)],
  );
  return id;
}

/**
 * Gives a tenant a data model to work against, as its version 1.
 *
 * A new workspace starts with no objects — that is the product, and it is why
 * two generated CRMs no longer look alike. A test that needs contacts and deals
 * has to say so.
 *
 * It writes version 1 rather than committing a patch on top of it, so a test
 * that counts versions still counts what it meant to count. Written through the
 * admin pool, like every other fixture here.
 */
export async function seedModel(
  pool: Pool,
  tenantId: string,
  config: Config = defaultConfig(),
): Promise<void> {
  await pool.query(
    `insert into config_versions (tenant_id, version, parent_id, config, patch, author, summary)
     values ($1, 1, null, $2, '[]'::jsonb, 'system', 'Test fixture model')
     on conflict (tenant_id, version) do nothing`,
    [tenantId, JSON.stringify(config)],
  );
}

export async function dropTenants(pool: Pool, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  /**
   * The queue outlives the tenant, and that is a real problem for the suite.
   * A test that runs an automation leaves queued jobs behind — a chained
   * record_updated, a resumed leg after a delay — and dropping the tenant does
   * not remove them. The next suite that drains the queue picks one up, cannot
   * load a workspace that no longer exists, and records a failure that belongs
   * to nobody. Take the jobs with the tenant.
   */
  await pool
    .query("delete from pgboss.job where (data->>'tenantId')::uuid = any($1)", [ids])
    .catch(() => {
      // pg-boss may never have been started in this run, so its schema may not
      // exist. Nothing queued means nothing to clean up.
    });

  await pool.query("delete from tenants where id = any($1)", [ids]);
}
