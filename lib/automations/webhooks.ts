import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { withoutTenant, withTenant } from "@/lib/db/client";
import { webhookEndpoints } from "@/lib/db/schema";
import { coerceValue } from "@/lib/runtime/field";
import type { Config, ObjectConfig } from "@/lib/config/types";

/**
 * Starting a workflow from outside.
 *
 * The token is the whole credential — there is nothing else for a caller to
 * present — so it is 32 random bytes, unique, and revoked by deleting the row.
 * A workflow gets one endpoint, and turning the endpoint off is what stops
 * strangers being able to make records in this workspace.
 */

export interface Endpoint {
  tenantId: string;
  automationId: string;
}

/** The endpoint for a workflow, created on first ask. */
export async function ensureEndpoint(tenantId: string, automationId: string): Promise<string> {
  const existing = await withTenant(tenantId, (db) =>
    db
      .select({ token: webhookEndpoints.token })
      .from(webhookEndpoints)
      .where(
        and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.automationId, automationId)),
      )
      .limit(1),
  );
  if (existing[0]) return existing[0].token;

  const token = randomBytes(32).toString("base64url");
  await withTenant(tenantId, (db) =>
    db.insert(webhookEndpoints).values({ tenantId, automationId, token }),
  );
  return token;
}

/** Revokes it. A posted body to a deleted token is refused, not queued. */
export async function removeEndpoint(tenantId: string, automationId: string): Promise<void> {
  await withTenant(tenantId, (db) =>
    db
      .delete(webhookEndpoints)
      .where(
        and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.automationId, automationId)),
      ),
  );
}

/**
 * Resolves a token to its workspace.
 *
 * An inbound POST has no session, so the tenant is not known until the token is
 * read — which cannot go through RLS, because RLS needs the tenant first. This
 * goes through `app_webhook_tenant`, a security definer function that takes
 * nothing but the token and returns nothing but ids. It is the second and last
 * path around the policies, and it is the reason everything after it can go
 * through `withTenant` as normal.
 */
export async function resolveEndpoint(token: string): Promise<Endpoint | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;

  const result = await withoutTenant((db) =>
    db.execute<{ tenant_id: string; automation_id: string }>(
      sql`select tenant_id, automation_id from app_webhook_tenant(${token})`,
    ),
  );

  const row = result.rows[0];
  return row ? { tenantId: row.tenant_id, automationId: row.automation_id } : null;
}

/**
 * Turns a posted body into record data.
 *
 * Keys are matched to the object's own field keys — post `{"email": "a@b.c"}`
 * and it lands in the field keyed `email`. Anything the object does not have a
 * field for is dropped rather than stored: a webhook is an untrusted caller,
 * and letting it write arbitrary keys into a record's JSON would be a way to
 * bloat the row and confuse every reader afterwards.
 */
export function mapWebhookBody(
  config: Config,
  object: ObjectConfig,
  body: Record<string, unknown>,
): { data: Record<string, unknown>; ignored: string[] } {
  const byKey = new Map(object.fields.map((field) => [field.key.toLowerCase(), field]));
  const data: Record<string, unknown> = {};
  const ignored: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    const field = byKey.get(key.toLowerCase());
    if (!field || field.type === "relation") {
      ignored.push(key);
      continue;
    }
    try {
      data[field.id] = coerceValue(field, value);
    } catch {
      ignored.push(key);
    }
  }

  return { data, ignored };
}

/**
 * A crude per-token ceiling. It lives in this process's memory, so on a
 * serverless host it limits per instance rather than globally — worth having
 * against a stuck retry loop, not a substitute for a real limiter at the edge.
 */
const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

export function withinRateLimit(token: string): boolean {
  const now = Date.now();
  const current = hits.get(token);

  if (!current || current.resetAt < now) {
    hits.set(token, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  current.count++;
  return current.count <= MAX_PER_WINDOW;
}
