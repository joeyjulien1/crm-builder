import { getBoss, QUEUES, type TenantJob } from "./queue";

/**
 * Turning the crank by hand.
 *
 * `npm run worker` is the real worker: a process that sits there and consumes.
 * On a serverless host there is no such process, so this drains the same queues
 * on demand instead — same jobs, same handlers, same run log, same idempotency
 * keys and retries. What changes is only what wakes the worker up: an HTTP
 * request rather than a daemon.
 *
 * A job still runs out-of-band from the request that enqueued it, which is the
 * part that matters: an import of twenty thousand rows is not done inside the
 * request that uploaded the file.
 */

/** Kept under the platform's function timeout, with room to finish a job. */
const DEFAULT_BUDGET_MS = 8_000;
const BATCH = 5;

export interface DrainResult {
  processed: number;
  failed: number;
  /** True when work was left behind and the caller should come back. */
  remaining: boolean;
}

type Handler = (data: TenantJob) => Promise<void>;

async function handlers(): Promise<Record<string, Handler>> {
  const [{ runAutomation }, { runImport, failImport }, { backfillPage, syncSince }] = await Promise.all([
    import("@/lib/automations/run"),
    import("@/lib/import/run"),
    import("@/lib/email/sync"),
  ]);

  return {
    [QUEUES.noop]: async () => {},

    [QUEUES.automation]: async (data) => {
      const outcome = await runAutomation(data as Parameters<typeof runAutomation>[0]);
      if (outcome.status === "failed") throw new Error(outcome.error ?? "Automation failed");
    },

    [QUEUES.import]: async (data) => {
      const payload = data as Parameters<typeof runImport>[0];
      try {
        await runImport(payload);
      } catch (error) {
        await failImport(
          payload.tenantId,
          payload.importJobId,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    },

    [QUEUES.emailBackfill]: async (data) => {
      const payload = data as TenantJob & { accountId: string };
      const result = await backfillPage(payload.tenantId, payload.accountId);
      if (!result.done) {
        const { enqueue } = await import("./queue");
        await enqueue(QUEUES.emailBackfill, payload, {
          singletonKey: `backfill:${payload.accountId}`,
        });
      }
    },

    [QUEUES.emailSync]: async (data) => {
      const payload = data as TenantJob & { accountId: string };
      await syncSince(payload.tenantId, payload.accountId);
    },
  };
}

/**
 * Drains whatever is queued until the time budget runs out. Jobs are taken in
 * queue order, not filtered by who asked — a queue is shared infrastructure,
 * and each job opens its own tenant-scoped transaction from its own payload, so
 * running someone else's queued job cannot cross a tenant boundary.
 */
export async function drainQueues(budgetMs = DEFAULT_BUDGET_MS): Promise<DrainResult> {
  const boss = await getBoss();
  const registry = await handlers();
  const deadline = Date.now() + budgetMs;

  let processed = 0;
  let failed = 0;
  let remaining = false;

  for (const queue of Object.values(QUEUES)) {
    while (Date.now() < deadline) {
      const jobs = await boss.fetch<TenantJob>(queue, { batchSize: BATCH });
      if (jobs.length === 0) break;

      for (const job of jobs) {
        if (Date.now() >= deadline) {
          // Hand it back rather than starting work we cannot finish.
          await boss.fail(queue, job.id, { reason: "drain budget exhausted" }).catch(() => {});
          remaining = true;
          continue;
        }

        try {
          await registry[queue]?.(job.data);
          await boss.complete(queue, job.id);
          processed++;
        } catch (error) {
          await boss
            .fail(queue, job.id, { message: error instanceof Error ? error.message : String(error) })
            .catch(() => {});
          failed++;
        }
      }
    }

    if (Date.now() >= deadline) {
      remaining = true;
      break;
    }
  }

  if (!remaining) {
    // Anything still queued after a clean pass means come back again.
    for (const queue of Object.values(QUEUES)) {
      const size = await boss.getQueueSize(queue).catch(() => 0);
      if (size > 0) {
        remaining = true;
        break;
      }
    }
  }

  return { processed, failed, remaining };
}
