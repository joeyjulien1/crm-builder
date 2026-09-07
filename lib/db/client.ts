import { Pool, type PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let pool: Pool | undefined;

export type DbSsl = { rejectUnauthorized: boolean; ca?: string } | false;

/**
 * A managed Postgres needs TLS, and a local one on a socket does not. Decide
 * from the host rather than making every environment carry a flag.
 *
 * Managed providers commonly present a certificate signed by their own CA,
 * which Node does not trust. There are two ways through that, and they are not
 * equivalent:
 *
 * - DATABASE_CA_CERT holds the provider's CA certificate, and the connection is
 *   verified against it. Encrypted and authenticated. Prefer this.
 * - DATABASE_SSL_NO_VERIFY=1 accepts whatever certificate is offered. Still
 *   encrypted, no longer authenticated, so a machine-in-the-middle between the
 *   app and the database would not be detected.
 */
export function sslFor(connectionString: string): DbSsl {
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    return false;
  }

  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  if (local) return false;

  // Environment variables flatten newlines, and a PEM without them is not a PEM.
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n").trim();
  if (ca) return { rejectUnauthorized: true, ca };

  return { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== "1" };
}

/** The application pool. Connects as a role without bypassrls. */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({
      connectionString,
      ssl: sslFor(connectionString),
      // Serverless runs many short-lived instances against a shared pooler, so
      // each one keeps only a small number of connections and lets them go.
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

/**
 * Runs `fn` inside a transaction with `app.tenant_id` set for that transaction
 * only. Transaction scope is what makes this safe under a connection pool: a
 * session-scoped setting would leak one tenant's id into the next request that
 * borrowed the same connection.
 *
 * This is the only way tenant-scoped tables should be reached. Do not open raw
 * connections.
 */
async function beginApplicationTransaction(client: PoolClient, tenantId = ""): Promise<void> {
  // The login may be a managed provider's owner account. Never let its elevated
  // privileges reach application queries: SET LOCAL expires with this transaction.
  await client.query("begin; set local role crm_app");
  const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "select set_config('app.tenant_id', $1, true), rolsuper, rolbypassrls from pg_roles where rolname = current_user",
    [tenantId],
  );
  const role = rows[0];
  if (!role || role.rolsuper || role.rolbypassrls) {
    throw new Error("The crm_app database role must be NOSUPERUSER NOBYPASSRLS.");
  }
}

export async function withTenant<T>(tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error("withTenant requires a uuid tenant id");

  const client = await getPool().connect();
  try {
    await beginApplicationTransaction(client, tenantId);
    const db = drizzle(client, { schema });
    const result = await fn(db);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * For the tables that are not tenant-scoped: users, sessions, roles. Anything
 * that touches a tenant-scoped table through this helper will see zero rows,
 * because the policies fail closed when `app.tenant_id` is unset.
 */
export async function withoutTenant<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await beginApplicationTransaction(client);
    const result = await fn(drizzle(client, { schema }));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Escape hatch for migrations and tests. Never import this from app code. */
export function createAdminPool(): Pool {
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL is not set");
  return new Pool({ connectionString, ssl: sslFor(connectionString), max: 4 });
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export type { PoolClient };
export { schema };
