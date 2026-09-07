import { afterEach, describe, expect, it } from "vitest";
import { sslFor } from "./client";

const REMOTE = "postgresql://u:p@db.example.supabase.co:6543/postgres";

afterEach(() => {
  delete process.env.DATABASE_CA_CERT;
  delete process.env.DATABASE_SSL_NO_VERIFY;
});

/**
 * How the database connection is trusted is a security decision, so it gets
 * tests rather than a comment.
 */
describe("choosing TLS settings for a connection", () => {
  it("does not use TLS for a local connection", () => {
    expect(sslFor("postgresql://u:p@localhost:5432/crm")).toBe(false);
    expect(sslFor("postgresql://u:p@127.0.0.1:5432/crm")).toBe(false);
  });

  it("verifies against the system CAs by default", () => {
    expect(sslFor(REMOTE)).toEqual({ rejectUnauthorized: true });
  });

  it("verifies against a supplied CA when one is given", () => {
    process.env.DATABASE_CA_CERT = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----";
    const ssl = sslFor(REMOTE);
    expect(ssl).toMatchObject({ rejectUnauthorized: true });
    expect(ssl && ssl.ca).toContain("BEGIN CERTIFICATE");
  });

  it("restores newlines an environment variable flattened", () => {
    process.env.DATABASE_CA_CERT = "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----";
    const ssl = sslFor(REMOTE);
    expect(ssl && ssl.ca).toBe(
      "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----",
    );
  });

  it("prefers a supplied CA over disabling verification", () => {
    process.env.DATABASE_CA_CERT = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----";
    process.env.DATABASE_SSL_NO_VERIFY = "1";
    expect(sslFor(REMOTE)).toMatchObject({ rejectUnauthorized: true });
  });

  it("waives verification only when explicitly asked", () => {
    process.env.DATABASE_SSL_NO_VERIFY = "1";
    expect(sslFor(REMOTE)).toEqual({ rejectUnauthorized: false });
  });
});
