import { getSession } from "@/lib/auth/session";
import { cronAuthorized } from "@/lib/jobs/cron";
import { drainQueues } from "@/lib/jobs/drain";

/**
 * Serverless has nowhere to run a worker process, so the queue is drained by
 * request instead.
 *
 * Two callers, both authenticated. A signed-in user's client drains while it
 * polls a job it started; the platform's scheduler drains on a timer, which is
 * what makes a delayed automation step fire when nobody is looking. It returns
 * counts rather than anything about the jobs themselves.
 */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) {
    const session = await getSession();
    if (!session) return new Response("Sign in to continue.", { status: 401 });
  }

  try {
    const result = await drainQueues();
    return Response.json(result);
  } catch (error) {
    console.error("drain failed:", error);
    return new Response("Queued work could not be processed.", { status: 500 });
  }
}

/** The scheduler invokes crons with GET. */
export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response("This endpoint is for the scheduler.", { status: 401 });
  return POST(request);
}
