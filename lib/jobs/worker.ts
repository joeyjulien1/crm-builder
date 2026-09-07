import { getBoss, QUEUES, stopBoss, type TenantJob } from "./queue";

/**
 * The worker process. Run it alongside the app: `npm run worker`.
 * Handlers are registered here and implemented next to the feature they serve.
 */
export async function startWorkers(): Promise<void> {
  const boss = await getBoss();

  await boss.work<TenantJob>(QUEUES.noop, async (jobs) => {
    for (const job of jobs) {
      console.log(`noop job ${job.id} for tenant ${job.data.tenantId}`);
    }
  });

  const { registerAutomationWorker } = await import("@/lib/automations/worker");
  await registerAutomationWorker(boss);

  const { registerImportWorker } = await import("@/lib/import/worker");
  await registerImportWorker(boss);

  const { registerEmailWorkers } = await import("@/lib/email/worker");
  await registerEmailWorkers(boss);

  console.log("Workers started");
}

const isEntrypoint = process.argv[1]?.endsWith("worker.ts");
if (isEntrypoint) {
  startWorkers().catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void stopBoss().then(() => process.exit(0));
    });
  }
}
