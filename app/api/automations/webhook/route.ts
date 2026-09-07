import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { getCurrentVersion } from "@/lib/config/version";
import { ensureEndpoint, removeEndpoint } from "@/lib/automations/webhooks";

/**
 * The URL an outside system posts to, minted on demand for a workflow whose
 * trigger is a webhook. Creating it is the moment this workspace becomes
 * reachable from outside, so it happens when someone asks — never as a side
 * effect of picking a trigger.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });
  if (!session.canEditConfig) {
    return new Response("Your role cannot change this workspace's configuration.", { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { automationId?: string } | null;
  if (!body?.automationId) return new Response("There is no workflow to connect.", { status: 400 });

  const automation = await withTenant(session.tenantId, async (db) => {
    const { config } = await getCurrentVersion(db, session.tenantId);
    return config.automations.find((candidate) => candidate.id === body.automationId);
  });

  if (!automation) return new Response("That workflow no longer exists.", { status: 404 });
  if (automation.trigger.type !== "webhook_received") {
    return new Response("That workflow is not started by a webhook.", { status: 409 });
  }

  const token = await ensureEndpoint(session.tenantId, automation.id);
  const origin = process.env.APP_URL ?? new URL(request.url).origin;
  return Response.json({ url: `${origin.replace(/\/$/, "")}/api/hooks/${token}` });
}

/** Revokes the endpoint. Anything still posting to it gets a 404 from then on. */
export async function DELETE(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });
  if (!session.canEditConfig) {
    return new Response("Your role cannot change this workspace's configuration.", { status: 403 });
  }

  const automationId = new URL(request.url).searchParams.get("automationId");
  if (!automationId) return new Response("There is no endpoint to revoke.", { status: 400 });

  await removeEndpoint(session.tenantId, automationId);
  return Response.json({ revoked: true });
}
