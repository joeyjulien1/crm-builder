import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { closePool, withTenant } from "@/lib/db/client";
import { connections } from "@/lib/db/schema";
import { adminPool, createTenant, createUser, dropTenants } from "@/test/helpers";
import { authorizeUrl, redirectUri } from "./oauth";
import { isConfigured, PROVIDERS, providerFor } from "./registry";
import { connectorStates, isConnected } from "./status";

describe("the connector registry", () => {
  it("has a unique key per provider", () => {
    const keys = PROVIDERS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("asks for read-only scopes where a provider offers them", () => {
    const gmail = providerFor("gmail")!;
    expect(gmail.scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect((gmail.scopes ?? []).join(" ")).not.toMatch(/gmail\.modify|mail\.google\.com/);

    // Drive reads names and ownership, never file contents.
    const drive = providerFor("google_drive")!;
    expect(drive.scopes).toContain("https://www.googleapis.com/auth/drive.metadata.readonly");
  });

  it("treats a provider without credentials as unavailable", () => {
    delete process.env.NOTION_CLIENT_ID;
    delete process.env.NOTION_CLIENT_SECRET;
    expect(isConfigured(providerFor("notion")!)).toBe(false);
  });
});

describe("building the authorize URL", () => {
  beforeAll(() => {
    process.env.APP_URL = "https://crm.example.com";
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  });

  it("sends state, the redirect and the requested scopes", () => {
    const url = new URL(authorizeUrl(providerFor("gmail")!, "state-value"));
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("client_id")).toBe("test-client");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://crm.example.com/api/connectors/gmail/callback",
    );
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
  });

  it("asks Google for a refresh token, which it gives only when asked", () => {
    const url = new URL(authorizeUrl(providerFor("gmail")!, "s"));
    expect(url.searchParams.get("access_type")).toBe("offline");
  });

  it("never puts the client secret in a URL the browser sees", () => {
    const url = authorizeUrl(providerFor("gmail")!, "s");
    expect(url).not.toContain("test-secret");
  });

  it("gives each provider its own callback", () => {
    expect(redirectUri("slack")).toBe("https://crm.example.com/api/connectors/slack/callback");
  });

  it("refuses to build one for a provider with no credentials", () => {
    delete process.env.ZOOM_CLIENT_ID;
    expect(() => authorizeUrl(providerFor("zoom")!, "s")).toThrow(/not configured/);
  });
});

describe("connection state under tenant isolation", () => {
  let pool: Pool;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    pool = adminPool();
    tenantA = (await createTenant(pool, "Connect A")).id;
    tenantB = (await createTenant(pool, "Connect B")).id;
    // Users are not tenant-scoped, so they outlive dropTenants — unique per run.
    const emailA = `connect-a-${randomUUID()}@example.com`;
    userA = await createUser(pool, emailA);
    userB = await createUser(pool, `connect-b-${randomUUID()}@example.com`);

    await withTenant(tenantA, (db) =>
      db.insert(connections).values({
        tenantId: tenantA,
        userId: userA,
        provider: "gmail",
        externalAccountId: "google-1",
        accountLabel: emailA,
        accessTokenEnc: "enc",
        scopes: ["gmail.readonly"],
      }),
    );
  });

  afterAll(async () => {
    await dropTenants(pool, [tenantA, tenantB]);
    await pool.end();
    await closePool();
  });

  it("reports a connected provider for the user who connected it", async () => {
    expect(await isConnected(tenantA, userA, "gmail")).toBe(true);
  });

  it("does not leak a connection to another tenant", async () => {
    expect(await isConnected(tenantB, userB, "gmail")).toBe(false);

    const rows = await withTenant(tenantB, (db) => db.select().from(connections));
    expect(rows).toHaveLength(0);
  });

  it("lists every provider, connected or not, without exposing tokens", async () => {
    const states = await connectorStates(tenantA, userA);
    expect(states).toHaveLength(PROVIDERS.length);

    const gmail = states.find((s) => s.provider === "gmail")!;
    expect(gmail.connected).toBe(true);
    expect(gmail.account).toContain("connect-a-");
    expect(JSON.stringify(states)).not.toContain("enc");
  });
});
