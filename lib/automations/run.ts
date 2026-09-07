import { and, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { activityEntries, automationRuns } from "@/lib/db/schema";
import { getCurrentVersion } from "@/lib/config/version";
import { createRecord, getRecord, updateRecord } from "@/lib/runtime/records";
import type {
  AutomationConfig,
  AutomationStep,
  Config,
  CrmRecord,
  ObjectConfig,
  ObjectKey,
} from "@/lib/config/types";
import { sendAutomationEmail } from "@/lib/email/send";
import { callProvider, credentialValues } from "@/lib/connectors/call";
import { allConditionsHold } from "./evaluate";
import { mergeText, mergeValue, type MergeContext } from "./merge";
import { enqueue, QUEUES } from "@/lib/jobs/queue";
import {
  advance,
  delayMs,
  enterBranch,
  OTHERWISE,
  parseCursor,
  printCursor,
  START,
  stepAt,
  type StepCursor,
} from "./steps";
import { dispatchRecordEvent, MAX_DEPTH, type AutomationJob } from "./dispatch";

export interface RunOutcome {
  status: "completed" | "skipped" | "failed" | "waiting" | "depth_exceeded" | "duplicate";
  output?: Record<string, unknown>;
  error?: string;
}

/** What one step did, in the order the steps ran. Shown by the test panel. */
export interface StepReport {
  stepId: string;
  type: AutomationStep["type"];
  status: "ran" | "stopped" | "skipped" | "waiting" | "would_run";
  detail: string;
  output?: unknown;
}

/**
 * Runs one automation against one record, from the start or from wherever a
 * delay left off. Every run is written to automation_runs with its inputs, its
 * outputs, and the config version it ran under — an automation you cannot audit
 * is one you cannot trust with a customer's data.
 */
export async function runAutomation(job: AutomationJob): Promise<RunOutcome> {
  const { config, version } = await withTenant(job.tenantId, async (db) => {
    const current = await getCurrentVersion(db, job.tenantId);
    return { config: current.config, version: current.version };
  });

  const cursor = parseCursor(job.cursor) ?? START;

  // Claiming the idempotency key is what makes a retried job safe: the second
  // attempt finds the row already there and does nothing. A resumed leg carries
  // its own key, so waiting for two days does not make the rest of the run
  // look like a duplicate of the part before the wait.
  const claimed = await withTenant(job.tenantId, async (db) => {
    const inserted = await db
      .insert(automationRuns)
      .values({
        tenantId: job.tenantId,
        automationId: job.automationId,
        configVersion: version,
        depth: job.depth,
        status: "running",
        idempotencyKey: job.idempotencyKey,
        cursor,
        input: { recordId: job.recordId, trigger: job.trigger },
      })
      .onConflictDoNothing({ target: [automationRuns.tenantId, automationRuns.idempotencyKey] })
      .returning();
    return inserted[0];
  });

  if (!claimed) return { status: "duplicate" };

  const finish = async (outcome: RunOutcome, resumeAt?: StepCursor): Promise<RunOutcome> => {
    await withTenant(job.tenantId, (db) =>
      db
        .update(automationRuns)
        .set({
          status: outcome.status,
          output: outcome.output ?? {},
          error: outcome.error ?? null,
          cursor: resumeAt ?? null,
        })
        .where(and(eq(automationRuns.tenantId, job.tenantId), eq(automationRuns.id, claimed.id))),
    );
    return outcome;
  };

  const automation = config.automations.find((candidate) => candidate.id === job.automationId);
  if (!automation || !automation.enabled) return finish({ status: "skipped", error: "No longer active" });

  if (job.depth >= MAX_DEPTH) {
    // A hard stop, surfaced to the tenant rather than swallowed.
    await noteOnRecord(job.tenantId, job.recordId, "automation_error", {
      name: automation.name,
      message: `"${automation.name}" stopped after ${MAX_DEPTH} chained automations. Check whether two automations are triggering each other.`,
    });
    return finish({
      status: "depth_exceeded",
      error: `Stopped after ${MAX_DEPTH} chained automations`,
    });
  }

  const record = await withTenant(job.tenantId, (db) => getRecord(db, job.tenantId, job.recordId));
  if (!record) return finish({ status: "skipped", error: "The record no longer exists" });

  const result = await walk({
    config,
    automation,
    record,
    tenantId: job.tenantId,
    recordId: job.recordId,
    configVersion: version,
    depth: job.depth,
    cursor,
    dryRun: false,
  });

  const output: Record<string, unknown> = {
    steps: result.reports,
    ...(result.missingTokens.length ? { missingMergeFields: [...new Set(result.missingTokens)] } : {}),
  };

  if (result.error) {
    await noteOnRecord(job.tenantId, job.recordId, "automation_error", {
      name: automation.name,
      message: result.error,
    });
    return finish({ status: "failed", output, error: result.error });
  }

  if (result.status === "waiting" && result.resumeAt) {
    await enqueue<AutomationJob>(
      QUEUES.automation,
      {
        ...job,
        cursor: result.resumeAt,
        idempotencyKey: `${baseKey(job.idempotencyKey)}@${printCursor(result.resumeAt)}`,
      },
      { startAfter: new Date(Date.now() + result.waitMs!) },
    );
    return finish({ status: "waiting", output }, result.resumeAt);
  }

  if (result.status === "stopped") {
    return finish({ status: "skipped", output });
  }

  await noteOnRecord(job.tenantId, job.recordId, "automation", { name: automation.name });
  return finish({ status: "completed", output });
}

/** A resumed leg's key is "<original>@<cursor>", so the original is recoverable. */
function baseKey(key: string): string {
  const at = key.lastIndexOf("@");
  return at === -1 ? key : key.slice(0, at);
}

/**
 * Runs a workflow against a record without touching anything: no records
 * written, no mail sent, no webhook called. This is what the builder's "Test
 * workflow" runs, and it is the difference between pointing an automation at a
 * customer list confidently and hoping.
 */
export async function testAutomation(args: {
  tenantId: string;
  automationId: string;
  recordId: string;
}): Promise<{ reports: StepReport[]; missingMergeFields: string[]; error?: string }> {
  const { config, version } = await withTenant(args.tenantId, async (db) => {
    const current = await getCurrentVersion(db, args.tenantId);
    return { config: current.config, version: current.version };
  });

  const automation = config.automations.find((candidate) => candidate.id === args.automationId);
  if (!automation) return { reports: [], missingMergeFields: [], error: "That workflow no longer exists." };

  const record = await withTenant(args.tenantId, (db) => getRecord(db, args.tenantId, args.recordId));
  if (!record) return { reports: [], missingMergeFields: [], error: "That record no longer exists." };

  if (record.objectKey !== automation.trigger.objectKey) {
    return {
      reports: [],
      missingMergeFields: [],
      error: `This workflow runs on ${automation.trigger.objectKey} records, and that is a ${record.objectKey}.`,
    };
  }

  const result = await walk({
    config,
    automation,
    record,
    tenantId: args.tenantId,
    recordId: args.recordId,
    configVersion: version,
    depth: 0,
    cursor: START,
    dryRun: true,
  });

  return {
    reports: result.reports,
    missingMergeFields: [...new Set(result.missingTokens)],
    error: result.error,
  };
}

/* -------------------------------------------------------------------------- */
/* The step machine                                                            */
/* -------------------------------------------------------------------------- */

interface WalkArgs {
  config: Config;
  automation: AutomationConfig;
  record: CrmRecord;
  tenantId: string;
  recordId: string;
  configVersion: number;
  depth: number;
  cursor: StepCursor;
  dryRun: boolean;
}

interface WalkResult {
  status: "completed" | "stopped" | "waiting" | "failed";
  reports: StepReport[];
  missingTokens: string[];
  resumeAt?: StepCursor;
  waitMs?: number;
  error?: string;
}

/** Steps beyond this in one leg means a workflow that loops through a branch. */
const MAX_STEPS_PER_LEG = 100;

async function walk(args: WalkArgs): Promise<WalkResult> {
  const steps = args.automation.steps;
  const reports: StepReport[] = [];
  const missingTokens: string[] = [];

  const object = args.config.objects.find((candidate) => candidate.key === args.record.objectKey);
  const merge: MergeContext = { config: args.config, object, record: args.record };

  let cursor = args.cursor;
  let taken = 0;

  while (cursor.length > 0) {
    if (++taken > MAX_STEPS_PER_LEG) {
      return { status: "failed", reports, missingTokens, error: "This workflow ran too many steps in one go." };
    }

    const step = stepAt(steps, cursor);
    if (!step) break;

    if (step.type === "filter") {
      const holds = allConditionsHold(args.config, step.conditions, args.record.data);
      reports.push({
        stepId: step.id,
        type: step.type,
        status: holds ? "ran" : "stopped",
        detail: holds ? "Conditions held." : "Conditions did not hold, so the run stopped here.",
      });
      if (!holds) return { status: "stopped", reports, missingTokens };
      cursor = advance(steps, cursor);
      continue;
    }

    if (step.type === "branch") {
      const which = step.paths.findIndex((path) =>
        allConditionsHold(args.config, path.conditions, args.record.data),
      );
      const chosen = which === -1 ? OTHERWISE : which;
      const label = which === -1 ? "Otherwise" : step.paths[which]!.label;
      reports.push({
        stepId: step.id,
        type: step.type,
        status: which === -1 && !step.otherwise ? "skipped" : "ran",
        detail: `Took the "${label}" path.`,
      });
      cursor = enterBranch(steps, cursor, chosen);
      continue;
    }

    if (step.type === "delay") {
      const resumeAt = advance(steps, cursor);
      const wait = delayMs(step.amount, step.unit);
      reports.push({
        stepId: step.id,
        type: step.type,
        status: args.dryRun ? "would_run" : "waiting",
        detail: `${args.dryRun ? "Would wait" : "Waits"} ${step.amount} ${step.unit}.`,
      });
      if (args.dryRun) {
        cursor = resumeAt;
        continue;
      }
      if (resumeAt.length === 0) {
        // A delay as the last step waits for nothing. Finish rather than
        // queueing a leg that has no work in it.
        return { status: "completed", reports, missingTokens };
      }
      return { status: "waiting", reports, missingTokens, resumeAt, waitMs: wait };
    }

    try {
      const outcome = await runStep(step, { ...args, merge, missingTokens });
      reports.push({
        stepId: step.id,
        type: step.type,
        status: args.dryRun ? "would_run" : "ran",
        detail: outcome.detail,
        output: outcome.output,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reports.push({ stepId: step.id, type: step.type, status: "ran", detail: message });
      return { status: "failed", reports, missingTokens, error: message };
    }

    cursor = advance(steps, cursor);
  }

  return { status: "completed", reports, missingTokens };
}

interface StepContext extends WalkArgs {
  merge: MergeContext;
  missingTokens: string[];
}

interface StepOutcome {
  detail: string;
  output?: unknown;
}

async function runStep(step: AutomationStep, context: StepContext): Promise<StepOutcome> {
  const text = (template: string): string => {
    const result = mergeText(template, context.merge);
    context.missingTokens.push(...result.missing);
    return result.text;
  };

  switch (step.type) {
    case "set_field": {
      const merged = mergeValue(step.value, context.merge);
      context.missingTokens.push(...merged.missing);
      const label = fieldLabel(context.config, step.fieldId);

      if (context.dryRun) {
        return { detail: `Would set ${label}.`, output: { [step.fieldId]: merged.value } };
      }

      const result = await withTenant(context.tenantId, (db) =>
        updateRecord(
          db,
          context.tenantId,
          context.config,
          context.recordId,
          { [step.fieldId]: merged.value },
          `automation:${context.automation.name}`,
        ),
      );

      // A write from an automation is an event like any other, one level deeper.
      if (result.changedFieldIds.length > 0) {
        await dispatchRecordEvent({
          tenantId: context.tenantId,
          recordId: context.recordId,
          kind: "record_updated",
          changedFieldIds: result.changedFieldIds,
          configVersion: context.configVersion,
          depth: context.depth + 1,
        });
      }
      return {
        detail: result.changedFieldIds.length ? `Set ${label}.` : `${label} already had that value.`,
        output: { changed: result.changedFieldIds },
      };
    }

    case "create_record": {
      const merged = mergeValue(step.values, context.merge) as { value: Record<string, unknown>; missing: string[] };
      context.missingTokens.push(...merged.missing);
      const object = objectLabel(context.config, step.objectKey);

      if (context.dryRun) return { detail: `Would create a ${object}.`, output: merged.value };

      const created = await withTenant(context.tenantId, (db) =>
        createRecord(
          db,
          context.tenantId,
          context.config,
          step.objectKey,
          merged.value,
          `automation:${context.automation.name}`,
        ),
      );

      await dispatchRecordEvent({
        tenantId: context.tenantId,
        recordId: created.id,
        kind: "record_created",
        changedFieldIds: Object.keys(merged.value),
        configVersion: context.configVersion,
        depth: context.depth + 1,
      });
      return { detail: `Created a ${object}.`, output: { created: created.id } };
    }

    case "create_task": {
      const activity = context.config.objects.find((object) => object.key === "activity");
      const subjectField = activity?.titleFieldId ?? activity?.fields[0]?.id;
      const dueField = activity?.fields.find((field) => field.type === "datetime")?.id;
      if (!subjectField) throw new Error("This workspace has no activity object to put a task on.");

      const title = text(step.title);
      const dueAt = new Date(Date.now() + step.dueInDays * 86_400_000).toISOString();

      if (context.dryRun) return { detail: `Would create the task "${title}".`, output: { title, dueAt } };

      const created = await withTenant(context.tenantId, (db) =>
        createRecord(
          db,
          context.tenantId,
          context.config,
          "activity" as ObjectKey,
          { [subjectField]: title, ...(dueField ? { [dueField]: dueAt } : {}) },
          `automation:${context.automation.name}`,
        ),
      );

      await dispatchRecordEvent({
        tenantId: context.tenantId,
        recordId: created.id,
        kind: "record_created",
        changedFieldIds: [subjectField],
        configVersion: context.configVersion,
        depth: context.depth + 1,
      });
      return { detail: `Created the task "${title}".`, output: { task: created.id } };
    }

    case "send_email": {
      const to = text(step.to);
      const subject = text(step.subject);
      const body = text(step.body);

      if (context.dryRun) return { detail: `Would email ${to}.`, output: { to, subject, body } };

      const sent = await sendAutomationEmail(context.tenantId, { to, subject, body });
      return { detail: `Emailed ${to}.`, output: sent };
    }

    case "call_webhook": {
      const merged = mergeValue(step.body ?? { recordId: context.recordId }, context.merge);
      context.missingTokens.push(...merged.missing);

      if (context.dryRun) {
        return { detail: `Would call ${step.url}.`, output: { method: step.method, body: merged.value } };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(step.url, {
          method: step.method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(merged.value),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`${step.url} answered ${response.status}`);
        return { detail: `Called ${step.url}.`, output: { status: response.status } };
      } finally {
        clearTimeout(timeout);
      }
    }

    case "send_slack": {
      const channel = text(step.channel);
      const message = text(step.text);

      if (context.dryRun) {
        return { detail: `Would post to ${channel} in Slack.`, output: { channel, text: message } };
      }

      const answer = await callProvider(context.tenantId, "slack", {
        path: "chat.postMessage",
        body: { channel, text: message },
      });
      return { detail: `Posted to ${channel} in Slack.`, output: answer.body };
    }

    case "send_sms": {
      const to = text(step.to);
      const body = text(step.body);

      if (context.dryRun) return { detail: `Would text ${to}.`, output: { to, body } };

      const credentials = await credentialValues(context.tenantId, "twilio");
      const answer = await callProvider(context.tenantId, "twilio", {
        path: `Accounts/${credentials.accountSid}/Messages.json`,
        body: new URLSearchParams({ To: to, From: credentials.fromNumber ?? "", Body: body }),
      });
      return { detail: `Texted ${to}.`, output: answer.body };
    }

    case "filter":
    case "delay":
    case "branch":
      // Handled by the walker, which needs to move the cursor rather than
      // return a value. Reaching here would be a bug in that walk.
      throw new Error(`${step.type} is a control step and cannot run on its own.`);
  }
}

function fieldLabel(config: Config, fieldId: string): string {
  for (const object of config.objects) {
    const field = object.fields.find((candidate) => candidate.id === fieldId);
    if (field) return field.label;
  }
  return "a field";
}

function objectLabel(config: Config, objectKey: string): string {
  const object: ObjectConfig | undefined = config.objects.find((candidate) => candidate.key === objectKey);
  return object?.label.toLowerCase() ?? objectKey;
}

async function noteOnRecord(
  tenantId: string,
  recordId: string,
  kind: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await withTenant(tenantId, (db) =>
    db.insert(activityEntries).values({ tenantId, recordId, kind, actor: "automation", detail }),
  );
}
