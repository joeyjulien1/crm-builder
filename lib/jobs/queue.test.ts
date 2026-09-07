import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getBoss, stopBoss, type TenantJob } from "./queue";

describe("pg-boss", () => {
  afterAll(async () => {
    await stopBoss();
  });

  it("runs a job through Postgres with no other queue service", async () => {
    const boss = await getBoss();
    const tenantId = randomUUID();

    // A queue of its own, so a worker process running alongside the suite
    // cannot take the job before this test's handler sees it.
    const queue = `noop.test.${randomUUID()}`;
    await boss.createQueue(queue);

    const seen: string[] = [];
    await boss.work<TenantJob>(queue, async (jobs) => {
      for (const job of jobs) seen.push(job.data.tenantId);
    });

    const jobId = await boss.send(queue, { tenantId }, { retryLimit: 1 });
    expect(jobId).toBeTruthy();

    const deadline = Date.now() + 15_000;
    while (!seen.includes(tenantId) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(seen).toContain(tenantId);
  });
});
