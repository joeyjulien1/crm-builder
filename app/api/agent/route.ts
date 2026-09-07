import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { withTenant } from "@/lib/db/client";
import { getCurrentVersion } from "@/lib/config/version";
import { countByObject } from "@/lib/runtime/records";
import { runAgentTurn, AgentError, type AgentImage, type AgentMessage } from "@/lib/agent/execute";
import { BudgetError } from "@/lib/agent/budget";
import { fileBase64, getUpload, isUuid } from "@/lib/files";
import { readImportSample } from "@/lib/import/sample";
import { connectorStates } from "@/lib/connectors/status";

/**
 * Building a whole CRM is a dozen tool rounds and can take well over a minute,
 * so the default function duration would cut the stream off mid-build. 60s is
 * the ceiling on Vercel's Hobby plan; raise it on a paid plan.
 */
export const maxDuration = 60;

/** How much of the conversation comes back with each turn. */
const MAX_HISTORY_MESSAGES = 20;

interface AgentRequestBody {
  prompt?: string;
  history?: { role?: string; text?: string }[];
  /** Upload ids attached to this message (POST /api/files). Resolved tenant-side. */
  files?: string[];
}

/** At most this many uploads ride one turn — each one costs vision tokens. */
const MAX_TURN_FILES = 4;

/** Text only. Tool calls stay server-side, where their results were produced. */
function readHistory(raw: AgentRequestBody["history"]): AgentMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => (entry?.role === "user" || entry?.role === "assistant") && entry.text?.trim())
    .slice(-MAX_HISTORY_MESSAGES)
    .map((entry) => ({ role: entry.role as "user" | "assistant", text: entry.text!.trim().slice(0, 8000) }));
}

/** Newline-delimited JSON, so the panel can render text as it arrives. */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Sign in to continue.", { status: 401 });

  if (!session.canEditConfig) return new Response("Your role cannot configure this workspace.", { status: 403 });
  const parsed = z.object({
    prompt: z.string().trim().min(1).max(24000),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) })).max(MAX_HISTORY_MESSAGES).optional(),
    files: z.array(z.string()).max(MAX_TURN_FILES).optional(),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Send a prompt of 1–24,000 characters with valid conversation history.", { status: 400 });
  const body = parsed.data;
  const prompt = body.prompt;

  const { config, counts } = await withTenant(session.tenantId, async (db) => ({
    config: (await getCurrentVersion(db, session.tenantId)).config,
    counts: await countByObject(db, session.tenantId),
  }));

  // Uploads resolve tenant-side: an id from another tenant (or a forged one)
  // loads nothing, so the turn simply has no images rather than leaking.
  const fileIds = Array.isArray(body.files)
    ? body.files.filter(isUuid).slice(0, MAX_TURN_FILES)
    : [];
  const images: AgentImage[] = await withTenant(session.tenantId, async (db) => {
    const resolved: AgentImage[] = [];
    for (const fileId of fileIds) {
      const row = await getUpload(db, session.tenantId, fileId);
      if (!row) continue;
      resolved.push({
        fileId: row.id,
        filename: row.filename,
        mimeType: row.mimeType,
        kind: row.kind === "image" ? "image" : "data",
        data: row.kind === "image" ? fileBase64(row) : "",
      });
    }
    return resolved;
  });

  // The agent is told which accounts exist and whether they are connected —
  // never a token, and never a way to grant one itself.
  const connections = (await connectorStates(session.tenantId, session.userId))
    .filter((state) => state.configured)
    .map((state) => ({
      provider: state.provider,
      label: state.label,
      connected: state.connected,
      ...(state.account ? { account: state.account } : {}),
    }));

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      try {
        const result = await runAgentTurn({
          tenantId: session.tenantId,
          userId: session.userId,
          config,
          counts,
          history: readHistory(body.history),
          prompt,
          images,
          onText: (delta) => send({ type: "text", delta }),
          // Real steps, emitted as the agent calls each tool.
          onThinking: (steps) => send({ type: "thinking", steps }),
          // The agent's checklist, posted and updated by the agent itself.
          onPlan: (steps) => send({ type: "plan", steps }),
          sampleImportFile: (fileId) => readImportSample(session.tenantId, fileId),
          connections,
        });

        if (result.suggestions && result.suggestions.length > 0) {
          send({ type: "questions", questions: result.suggestions });
        }
        if (result.patches.length > 0 && result.impact) {
          send({ type: "patch", patches: result.patches, impact: result.impact });
        }
        if (result.connectRequest) {
          send({ type: "connect_required", ...result.connectRequest });
        }
        if (result.failure) {
          send({
            type: "error",
            message: `That change could not be made: ${result.failure}`,
          });
        }
        send({ type: "budget", remaining: result.budget.remaining, fraction: result.budget.fraction });
      } catch (error) {
        // A budget or configuration problem is the user's to act on, so it is
        // shown as written. Anything else is logged and reported plainly.
        const known = error instanceof BudgetError || error instanceof AgentError;
        if (!known) console.error("agent turn failed:", error);
        send({
          type: "error",
          message: known
            ? (error as Error).message
            : "The agent could not finish that. Try again, or rephrase what you need.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
