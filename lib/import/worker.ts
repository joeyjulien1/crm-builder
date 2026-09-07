import type PgBoss from "pg-boss";
import { QUEUES } from "@/lib/jobs/queue";
import { failImport, runImport, type ImportJobPayload } from "./run";

export async function registerImportWorker(boss: PgBoss): Promise<void> {
  await boss.work<ImportJobPayload>(QUEUES.import, async (jobs) => {
    for (const job of jobs) {
      try {
        await runImport(job.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await failImport(job.data.tenantId, job.data.importJobId, message);
        throw error;
      }
    }
  });
}
