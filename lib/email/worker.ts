import type PgBoss from "pg-boss";
import { enqueue, QUEUES } from "@/lib/jobs/queue";
import { backfillPage, syncSince } from "./sync";

export interface EmailJob {
  tenantId: string;
  accountId: string;
}

export async function registerEmailWorkers(boss: PgBoss): Promise<void> {
  // Backfill re-queues itself a page at a time, so it survives a restart and
  // never blocks the live sync behind it.
  await boss.work<EmailJob>(QUEUES.emailBackfill, async (jobs) => {
    for (const job of jobs) {
      const result = await backfillPage(job.data.tenantId, job.data.accountId);
      if (!result.done) {
        await enqueue<EmailJob>(QUEUES.emailBackfill, job.data, {
          singletonKey: `backfill:${job.data.accountId}`,
        });
      }
    }
  });

  await boss.work<EmailJob>(QUEUES.emailSync, async (jobs) => {
    for (const job of jobs) {
      await syncSince(job.data.tenantId, job.data.accountId);
    }
  });
}
