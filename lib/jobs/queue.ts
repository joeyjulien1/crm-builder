import PgBoss from "pg-boss";

/**
 * Background jobs run on Postgres. There is no Redis and no separate queue
 * service in this stack — see CLAUDE.md.
 */
export const QUEUES = {
  noop: "noop",
  automation: "automation.run",
  import: "import.run",
  emailBackfill: "email.backfill",
  emailSync: "email.sync",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

export function getBoss(): Promise<PgBoss> {
  if (boss) return Promise.resolve(boss);
  if (starting) return starting;

  starting = (async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");

    const instance = new PgBoss({ connectionString, schema: "pgboss" });
    instance.on("error", (error) => console.error("pg-boss:", error));
    await instance.start();
    for (const queue of Object.values(QUEUES)) {
      await instance.createQueue(queue);
    }
    boss = instance;
    return instance;
  })();

  return starting;
}

/**
 * Every job carries its tenant. Workers open their own tenant-scoped
 * transaction from it rather than trusting anything else in the payload.
 */
export interface TenantJob {
  tenantId: string;
}

export async function enqueue<T extends TenantJob>(
  queue: QueueName,
  data: T,
  options?: { singletonKey?: string; startAfter?: Date; retryLimit?: number },
): Promise<string | null> {
  const instance = await getBoss();
  return instance.send(queue, data, {
    retryLimit: options?.retryLimit ?? 3,
    retryBackoff: true,
    ...(options?.singletonKey ? { singletonKey: options.singletonKey } : {}),
    ...(options?.startAfter ? { startAfter: options.startAfter } : {}),
  });
}

export async function stopBoss(): Promise<void> {
  await boss?.stop({ wait: true });
  boss = undefined;
  starting = undefined;
}
