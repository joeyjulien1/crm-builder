import type PgBoss from "pg-boss";
import { QUEUES } from "@/lib/jobs/queue";
import { runAutomation } from "./run";
import type { AutomationJob } from "./dispatch";

export async function registerAutomationWorker(boss: PgBoss): Promise<void> {
  await boss.work<AutomationJob>(QUEUES.automation, async (jobs) => {
    for (const job of jobs) {
      const outcome = await runAutomation(job.data);
      if (outcome.status === "failed") {
        // Throwing hands the job back to pg-boss to retry; the idempotency key
        // makes sure the actions that already ran do not run again.
        throw new Error(outcome.error ?? "Automation failed");
      }
    }
  });
}
