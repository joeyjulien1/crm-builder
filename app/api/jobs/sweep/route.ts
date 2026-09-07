import { cronAuthorized, cronRefusal } from "@/lib/jobs/cron";
import { sweepAllTenants } from "@/lib/automations/dispatch";

/**
 * Time-based triggers, swept once a day. This queues jobs; the drain endpoint
 * (or a worker process) runs them.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function sweep(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return cronRefusal();

  try {
    return Response.json(await sweepAllTenants());
  } catch (error) {
    console.error("sweep failed:", error);
    return new Response("Scheduled triggers could not be swept.", { status: 500 });
  }
}

export const GET = sweep;
export const POST = sweep;
