import { withTenant } from "@/lib/db/client";
import { getCurrentVersion } from "@/lib/config/version";
import { createRecord } from "@/lib/runtime/records";
import { dispatchRecordEvent } from "@/lib/automations/dispatch";
import { mapWebhookBody, resolveEndpoint, withinRateLimit } from "@/lib/automations/webhooks";

/**
 * An inbound webhook: someone else's system starting a workflow here.
 *
 * The body is data, never instruction. It is matched against the object's own
 * fields, anything unrecognised is dropped, a record is created, and the
 * workflow is *queued* — nothing runs inside this request, so a slow workflow
 * cannot make the caller time out and retry.
 *
 * The token is the only credential. It identifies the workspace, which is why
 * it is 32 random bytes and why revoking it is a delete.
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  if (!withinRateLimit(token)) {
    return new Response("Too many posts to this endpoint. Slow down.", { status: 429 });
  }

  const endpoint = await resolveEndpoint(token);
  if (!endpoint) return new Response("No such endpoint.", { status: 404 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return new Response("That payload is too large for a webhook.", { status: 413 });
  }

  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return new Response("That body is not JSON.", { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return new Response("A webhook body has to be a JSON object.", { status: 400 });
  }

  try {
    const result = await withTenant(endpoint.tenantId, async (db) => {
      const { config, version } = await getCurrentVersion(db, endpoint.tenantId);
      const automation = config.automations.find((candidate) => candidate.id === endpoint.automationId);

      if (!automation || automation.trigger.type !== "webhook_received") {
        return { error: "That endpoint is no longer connected to a workflow." as const };
      }
      if (!automation.enabled) return { error: "That workflow is turned off." as const };

      const object = config.objects.find((candidate) => candidate.key === automation.trigger.objectKey);
      if (!object) return { error: "That workflow's object no longer exists." as const };

      const { data, ignored } = mapWebhookBody(config, object, body as Record<string, unknown>);
      const created = await createRecord(
        db,
        endpoint.tenantId,
        config,
        object.key,
        data,
        `webhook:${automation.name}`,
      );

      return { recordId: created.id, ignored, version };
    });

    if ("error" in result) return new Response(result.error, { status: 409 });

    // Queued, not run: the caller gets an answer immediately and the work
    // happens on the queue like every other automation run.
    await dispatchRecordEvent({
      tenantId: endpoint.tenantId,
      recordId: result.recordId,
      kind: "webhook_received",
      changedFieldIds: [],
      configVersion: result.version,
    });

    return Response.json({ accepted: true, recordId: result.recordId, ignored: result.ignored }, { status: 202 });
  } catch (error) {
    console.error("webhook failed:", error);
    return new Response("That webhook could not be accepted.", { status: 500 });
  }
}
