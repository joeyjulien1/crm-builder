import { randomUUID } from "node:crypto";
import { withTenant } from "@/lib/db/client";
import { getCurrentVersion } from "@/lib/config/version";
import { getRecord } from "@/lib/runtime/records";
import { enqueue, QUEUES } from "@/lib/jobs/queue";
import type { AutomationConfig, Config } from "@/lib/config/types";

/** Without a ceiling, two automations that update each other run forever. */
export const MAX_DEPTH = 5;

export interface RecordEvent {
  tenantId: string;
  recordId: string;
  kind: "record_created" | "record_updated" | "form_submitted" | "webhook_received";
  changedFieldIds: string[];
  configVersion: number;
  /** How many automations deep this event already is. */
  depth?: number;
}

export interface AutomationJob {
  tenantId: string;
  automationId: string;
  recordId: string;
  configVersion: number;
  depth: number;
  idempotencyKey: string;
  trigger: string;
  /** Where a delayed run picks up. Absent on the first leg. See ./steps. */
  cursor?: number[];
}

/**
 * Matches an event against the tenant's automations and queues one job per
 * match. Matching is cheap and synchronous; running is not, so it happens on a
 * worker.
 */
export async function dispatchRecordEvent(event: RecordEvent): Promise<void> {
  const depth = event.depth ?? 0;
  if (depth > MAX_DEPTH) return;

  const { config, record } = await withTenant(event.tenantId, async (db) => ({
    config: (await getCurrentVersion(db, event.tenantId)).config,
    record: await getRecord(db, event.tenantId, event.recordId),
  }));

  if (!record) return;

  const eventId = randomUUID();

  for (const automation of config.automations) {
    if (!automation.enabled) continue;
    if (!triggerMatches(automation, event, record.objectKey)) continue;

    await enqueue<AutomationJob>(QUEUES.automation, {
      tenantId: event.tenantId,
      automationId: automation.id,
      recordId: event.recordId,
      configVersion: event.configVersion,
      depth,
      // A retried job carries the same key, so its actions do not run twice.
      idempotencyKey: `${automation.id}:${event.recordId}:${eventId}`,
      trigger: automation.trigger.type,
    });
  }
}

function triggerMatches(
  automation: AutomationConfig,
  event: RecordEvent,
  objectKey: string,
): boolean {
  const trigger = automation.trigger;
  if (trigger.objectKey !== objectKey) return false;

  switch (trigger.type) {
    case "record_created":
      return event.kind === "record_created";
    case "record_updated":
      return event.kind === "record_updated";
    case "field_changed":
      return event.kind === "record_updated" && event.changedFieldIds.includes(trigger.fieldId);
    case "form_submitted":
      return event.kind === "form_submitted";
    case "webhook_received":
      // The endpoint creates the record and says so; a plain create must not
      // also fire this, or every imported row would post to the workflow.
      return event.kind === "webhook_received";
    case "date_reached":
    case "schedule":
      // Time-based triggers are swept on a schedule, not fired by a write.
      return false;
  }
}

/**
 * The sweep for time-based triggers: dates that have arrived, and cadences that
 * fall due today. Run it once a day; it queues a job per matching record and
 * returns, so nothing runs inside the request.
 */
export async function dispatchDueDates(tenantId: string): Promise<number> {
  const { config, version } = await withTenant(tenantId, async (db) => {
    const current = await getCurrentVersion(db, tenantId);
    return { config: current.config, version: current.version };
  });

  const today = new Date();
  const stamp = today.toISOString().slice(0, 10);
  let queued = 0;

  for (const automation of config.automations) {
    if (!automation.enabled) continue;
    const trigger = automation.trigger;

    let due: string[] = [];
    if (trigger.type === "date_reached") {
      due = await findDueRecords(tenantId, config, trigger.objectKey, trigger.fieldId, trigger.offsetDays);
    } else if (trigger.type === "schedule" && cadenceFallsDue(trigger, today)) {
      due = await findAllRecords(tenantId, trigger.objectKey);
    } else {
      continue;
    }

    for (const recordId of due) {
      await enqueue<AutomationJob>(QUEUES.automation, {
        tenantId,
        automationId: automation.id,
        recordId,
        configVersion: version,
        depth: 0,
        // One firing per record per day, whatever the sweep's cadence.
        idempotencyKey: `${automation.id}:${recordId}:${stamp}`,
        trigger: trigger.type,
      });
      queued++;
    }
  }
  return queued;
}

/** Whether a cadence falls due on this date. Dates are read in UTC. */
export function cadenceFallsDue(
  trigger: { cadence: "daily" | "weekly" | "monthly"; weekday?: number; dayOfMonth?: number },
  on: Date,
): boolean {
  if (trigger.cadence === "daily") return true;
  if (trigger.cadence === "weekly") return on.getUTCDay() === (trigger.weekday ?? 1);
  return on.getUTCDate() === (trigger.dayOfMonth ?? 1);
}

/**
 * Every live record of one object. Capped: a scheduled workflow over a hundred
 * thousand records is a different feature, and queueing that many jobs from a
 * cron would be a denial of service on the workspace's own queue.
 */
async function findAllRecords(tenantId: string, objectKey: string): Promise<string[]> {
  const { and, eq, isNull } = await import("drizzle-orm");
  const { records } = await import("@/lib/db/schema");

  return withTenant(tenantId, async (db) => {
    const rows = await db
      .select({ id: records.id })
      .from(records)
      .where(
        and(eq(records.tenantId, tenantId), eq(records.objectKey, objectKey), isNull(records.deletedAt)),
      )
      .limit(1000);
    return rows.map((row) => row.id);
  });
}

async function findDueRecords(
  tenantId: string,
  config: Config,
  objectKey: string,
  fieldId: string,
  offsetDays: number,
): Promise<string[]> {
  const { and, eq, isNull, sql } = await import("drizzle-orm");
  const { records } = await import("@/lib/db/schema");

  return withTenant(tenantId, async (db) => {
    const rows = await db
      .select({ id: records.id })
      .from(records)
      .where(
        and(
          eq(records.tenantId, tenantId),
          eq(records.objectKey, objectKey),
          isNull(records.deletedAt),
          sql`(${records.data} ->> ${fieldId})::date + make_interval(days => ${offsetDays}) <= current_date`,
          sql`${records.data} ->> ${fieldId} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'`,
        ),
      )
      .limit(1000);

    return rows.map((row) => row.id);
  });
}

/**
 * The scheduler's entry point: sweep every workspace for time-based triggers.
 *
 * `dispatchDueDates` is per tenant because everything else in this file is, but
 * nothing wakes it up on its own — a date trigger that only fires when someone
 * happens to be looking at the app is not a date trigger. One cron calls this;
 * it queues the work and returns, so no run happens inside the request.
 */
export async function sweepAllTenants(): Promise<{ tenants: number; queued: number; failed: number }> {
  const { withoutTenant } = await import("@/lib/db/client");
  const { tenants } = await import("@/lib/db/schema");

  const rows = await withoutTenant((db) => db.select({ id: tenants.id }).from(tenants));

  let queued = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      queued += await dispatchDueDates(row.id);
    } catch (error) {
      // One workspace's bad config must not stop the sweep for everyone else.
      failed++;
      console.error(`sweep failed for tenant ${row.id}:`, error);
    }
  }

  return { tenants: rows.length, queued, failed };
}
