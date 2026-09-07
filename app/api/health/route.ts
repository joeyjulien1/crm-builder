import { withoutTenant, sslFor } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { TENANT_SCOPED_TABLES } from "@/lib/db/schema";

/** Every table the app expects to exist. A missing one means a migration has not run. */
const EXPECTED_TABLES = [...TENANT_SCOPED_TABLES, "tenants", "users", "roles", "sessions"].sort();

/**
 * Says why the app cannot reach its database.
 *
 * In production Next.js replaces a server exception with a digest, which tells
 * an operator nothing. Configuration is the thing most likely to be wrong on a
 * fresh deploy, so it gets an endpoint that answers in one request.
 *
 * It reports whether variables are set and how the connection failed. It never
 * reports their values, and it classifies the database host rather than naming
 * it, so this is safe to leave reachable.
 */

export const dynamic = "force-dynamic";

/** Postgres SQLSTATEs and Node socket errors worth explaining. */
const DIAGNOSES: Record<string, string> = {
  SELF_SIGNED_CERT_IN_CHAIN:
    "The database's TLS certificate is signed by a CA this server does not trust. Download the provider's CA certificate (Supabase: Settings -> Database -> SSL configuration) and put its contents in DATABASE_CA_CERT, which keeps the connection verified. DATABASE_SSL_NO_VERIFY=1 also connects, but encrypted-only, with no protection against a machine-in-the-middle.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    "The database's TLS certificate could not be verified. Same fix: DATABASE_CA_CERT with the provider's CA certificate, or DATABASE_SSL_NO_VERIFY=1 to accept it unverified.",
  ENOTFOUND:
    "That hostname does not resolve. Check the pooler prefix — Supabase uses aws-0-<region> or aws-1-<region>, and only one of them is yours.",
  ECONNREFUSED: "Nothing is listening on that port. The pooler is 6543; a direct connection is 5432.",
  ETIMEDOUT:
    "The connection timed out. Supabase's direct host is IPv6-only and is usually unreachable from serverless; use the pooler host on port 6543.",
  ENETUNREACH: "The network could not reach that address, which usually means an IPv6-only host. Use the pooler.",
  "28P01": "Password authentication failed. The password in DATABASE_URL does not match the crm_app role.",
  "28000":
    "The server rejected the user name. Through Supabase's pooler the user must be written as crm_app.<project-ref>, not plain crm_app.",
  "3D000": "That database does not exist. On Supabase the database name is 'postgres'.",
  "42501": "The crm_app role lacks a privilege it needs. Re-run the grants at the end of the init migration.",
};

/** Classifies the host without disclosing it. */
function describeHost(url: string | undefined): string {
  if (!url) return "unset";
  try {
    const { hostname, port } = new URL(url);
    if (hostname.includes("pooler.supabase.com")) return `supabase pooler (port ${port || "unset"})`;
    if (hostname.endsWith("supabase.co")) return `supabase direct (port ${port || "unset"})`;
    if (hostname === "localhost" || hostname === "127.0.0.1") return "localhost";
    return `other host (port ${port || "unset"})`;
  } catch {
    return "unparseable — DATABASE_URL is not a valid URL";
  }
}

/** Whether the connection is authenticated as well as encrypted. */
function describeTls(url: string | undefined): string {
  if (!url) return "unknown";
  const ssl = sslFor(url);
  if (ssl === false) return "off (local connection)";
  if (ssl.ca) return "verified against DATABASE_CA_CERT";
  if (!ssl.rejectUnauthorized) {
    return "encrypted but UNVERIFIED (DATABASE_SSL_NO_VERIFY=1) — set DATABASE_CA_CERT to authenticate the server";
  }
  return "verified against the system CAs";
}

export async function GET(): Promise<Response> {
  const databaseUrl = process.env.DATABASE_URL;

  const encryptionKey = process.env.ENCRYPTION_KEY;
  let encryptionKeyState = "unset (needed only for email sync)";
  if (encryptionKey) {
    const bytes = Buffer.from(encryptionKey, "base64").length;
    encryptionKeyState = bytes === 32 ? "ok" : `wrong length — decodes to ${bytes} bytes, needs 32`;
  }

  const report = {
    ok: false,
    database: {
      urlSet: Boolean(databaseUrl),
      host: describeHost(databaseUrl),
      tls: describeTls(databaseUrl),
      connected: false as boolean,
      error: null as string | null,
      diagnosis: null as string | null,
    },
    agent: process.env.ANTHROPIC_API_KEY ? "enabled" : "disabled (ANTHROPIC_API_KEY unset)",
    emailEncryptionKey: encryptionKeyState,
  };

  if (!databaseUrl) {
    report.database.diagnosis = "DATABASE_URL is not set. Nothing that touches data can work without it.";
    return Response.json(report, { status: 503 });
  }

  try {
    const { result, present } = await withoutTenant(async (db) => ({
      result: await db.execute<{ role: string; bypasses_rls: boolean }>(sql`select current_user as role, (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) as bypasses_rls`),
      present: await db.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public'`),
    }));
    const row = result.rows[0];
    report.database.connected = true;

    // A deployment can connect perfectly and still be missing a table, which
    // then fails one feature at a time rather than announcing itself.
    const have = new Set(present.rows.map((r) => r.table_name));
    const missing = EXPECTED_TABLES.filter((name) => !have.has(name));
    report.ok = missing.length === 0 && !row?.bypasses_rls;

    return Response.json({
      ...report,
      schema:
        missing.length === 0
          ? "up to date"
          : `MISSING ${missing.length} table(s): ${missing.join(", ")}. A migration in lib/db/migrations has not been applied to this database.`,
      // The invariant worth checking on every environment: a role that bypasses
      // RLS makes every tenant policy in this codebase decorative.
      tenancy: row?.bypasses_rls
        ? `UNSAFE: connected as '${row.role}', which bypasses row-level security. Tenant isolation is not being enforced.`
        : `enforced (connected as '${row?.role}', which cannot bypass row-level security)`,
    });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
    report.database.error = code;
    report.database.diagnosis = DIAGNOSES[code] ?? "The database refused the connection.";
    return Response.json(report, { status: 503 });
  }
}
