import { timingSafeEqual } from "node:crypto";

/**
 * Scheduled work has no session behind it, so the platform's scheduler
 * authenticates with a shared secret instead. Vercel sends
 * `Authorization: Bearer $CRON_SECRET` on every cron invocation; anything else
 * reaching these routes is refused.
 *
 * Unset secret means unauthorized, never "allow everyone" — a deployment that
 * forgot the variable should fail closed and say so in the log.
 */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const offered = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function cronRefusal(): Response {
  return new Response(
    process.env.CRON_SECRET
      ? "This endpoint is for the scheduler."
      : "CRON_SECRET is not set, so scheduled work cannot be authenticated.",
    { status: 401 },
  );
}
