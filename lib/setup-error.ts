/**
 * Turns an infrastructure failure into something an operator can act on.
 *
 * A misconfigured deployment throws deep in the database layer, and in
 * production Next.js replaces that with an opaque digest. The person looking at
 * the screen is usually the person who can fix it, so tell them which knob is
 * wrong instead of making them go and read a log.
 *
 * Returns null for anything that is not a setup problem, so real bugs keep
 * throwing and stay visible as bugs.
 */

const BY_CODE: Record<string, string> = {
  ENOTFOUND:
    "The database host in DATABASE_URL does not resolve. Check the hostname, then redeploy.",
  ECONNREFUSED:
    "Nothing is listening at the database address in DATABASE_URL. Check the port, then redeploy.",
  ETIMEDOUT:
    "The database did not answer in time. A direct Supabase host is IPv6-only and unreachable from most serverless platforms — use the connection pooler on port 6543.",
  ENETUNREACH:
    "The database address is unreachable, which usually means an IPv6-only host. Use the connection pooler instead.",
  SELF_SIGNED_CERT_IN_CHAIN:
    "The database's TLS certificate is signed by a CA this server does not trust. Put the provider's CA certificate in DATABASE_CA_CERT to verify against it, or set DATABASE_SSL_NO_VERIFY=1 to connect encrypted but unverified.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    "The database's TLS certificate could not be verified. Put the provider's CA certificate in DATABASE_CA_CERT, or set DATABASE_SSL_NO_VERIFY=1 to connect encrypted but unverified.",
  "28P01": "The database rejected the password in DATABASE_URL.",
  "28000":
    "The database rejected the user name in DATABASE_URL. Through a Supabase pooler it must be written as role.project-ref.",
  "3D000": "The database named in DATABASE_URL does not exist.",
  "42P01":
    "A table this app needs does not exist in the database. A migration in lib/db/migrations has not been applied — check /api/health, which names the missing tables.",
  "42501":
    "The database role in DATABASE_URL lacks a privilege it needs. Re-run the grants at the end of the init migration.",
};

/** Operator-readable text for a setup failure, or null if this is a real bug. */
export function describeSetupFailure(error: unknown): string | null {
  if (error instanceof Error && error.message === "DATABASE_URL is not set") {
    if (process.env.NODE_ENV === "development") {
      return "No database configured. Set DATABASE_URL in your .env file and run 'npm run db:migrate'.";
    }
    return "This deployment has no database configured. Set DATABASE_URL in the hosting environment and redeploy.";
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const described = BY_CODE[String(error.code)];
    if (described) return described;
  }

  return null;
}
