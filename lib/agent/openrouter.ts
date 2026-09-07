import { AGENT_TOOLS, runTool, type ToolContext } from "./tools";
import type { AgentImage } from "./execute";
import type { ConfigPatch } from "@/lib/config/types";

/**
 * OpenRouter speaks the OpenAI chat-completions dialect, so the tool list is
 * wrapped rather than rewritten, and tool results come back as their own
 * messages instead of as parts of a user turn.
 */
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/** Long enough to ride out a rate limit, short enough that a turn still ends. */
const MAX_BACKOFF_MS = 65_000;

export interface OpenRouterTurnResult {
  text: string;
  patches: ConfigPatch[];
  inputTokens: number;
  outputTokens: number;
}

interface ToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface Choice {
  message?: { content?: string | null; tool_calls?: ToolCall[] };
}

type MessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string | MessageContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

function backoffMs(attempt: number): number {
  return [1_000, 4_000, 10_000, 20_000][attempt] ?? 20_000;
}

/**
 * A free model shares an upstream pool, and a saturated pool says when to come
 * back. Honouring that beats guessing.
 */
function retryAfterMs(body: unknown): number | undefined {
  const seconds = (body as { error?: { metadata?: { retry_after_seconds?: number } } })?.error?.metadata
    ?.retry_after_seconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return undefined;
  // A second of slack, so the retry lands after the window rather than on it.
  return Math.min(seconds * 1000 + 1_000, MAX_BACKOFF_MS);
}

async function callOpenRouter(params: {
  apiKey: string;
  model: string;
  messages: Message[];
  timeoutMs: number;
  attempts: number;
}): Promise<Record<string, unknown>> {
  const { apiKey, model, messages, timeoutMs, attempts } = params;

  const tools = AGENT_TOOLS.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  }));

  let lastError = "";
  let waitMs = 0;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs || backoffMs(attempt - 1)));
    }
    waitMs = 0;

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          // OpenRouter attributes traffic with these; both are optional.
          "http-referer": process.env.APP_URL ?? "http://localhost:3000",
          "x-title": "CRM config agent",
        },
        body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Timeouts and network faults are worth retrying; both land here.
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }

    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number };
    };

    // OpenRouter can return 200 with an error body when an upstream fails.
    if (response.ok && !body.error) return body as Record<string, unknown>;

    const status = body.error?.code ?? response.status;
    lastError = `${status} ${body.error?.message ?? response.statusText}`;
    if (!RETRYABLE.has(status)) break;
    waitMs = retryAfterMs(body) ?? 0;
  }

  throw new Error(`OpenRouter (${model}): ${lastError}`);
}

/**
 * One turn against an OpenRouter model, running the tool loop to completion.
 * Building a CRM takes many calls — read the schema, add the fields, then build
 * the pipeline and views over them — so the loop has to finish the job.
 */
export async function runOpenRouterTurn(params: {
  apiKey: string;
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; text: string }[];
  images?: AgentImage[];
  context: ToolContext;
  maxRounds: number;
  timeoutMs: number;
  onText?: (delta: string) => void;
  onToolCall?: (name: string) => void;
  onPatches?: (patches: ConfigPatch[]) => Promise<string | undefined>;
}): Promise<OpenRouterTurnResult> {
  const { apiKey, model, system, context, maxRounds, timeoutMs, onText, onToolCall, onPatches } = params;

  const inlineImages = (params.images ?? []).filter((image) => image.kind === "image" && image.data);
  const withImages = (message: { role: "user" | "assistant"; text: string }, isLastUser: boolean): Message => {
    if (message.role !== "user" || !isLastUser || inlineImages.length === 0) {
      return message.role === "assistant"
        ? ({ role: "assistant", content: message.text } as Message)
        : ({ role: "user", content: message.text } as Message);
    }
    return {
      role: "user",
      content: [
        { type: "text", text: message.text },
        ...inlineImages.map((image) => ({
          type: "image_url" as const,
          image_url: { url: `data:${image.mimeType};base64,${image.data}` },
        })),
      ],
    };
  };

  const lastUserIndex = params.messages.map((message) => message.role).lastIndexOf("user");
  const messages: Message[] = [
    { role: "system", content: system },
    ...params.messages.map((message, index) => withImages(message, index === lastUserIndex)),
  ];

  const patches: ConfigPatch[] = [];
  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for (let round = 0; round < maxRounds; round++) {
    const data = await callOpenRouter({ apiKey, model, messages, timeoutMs, attempts: 4 });

    const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    inputTokens += usage?.prompt_tokens ?? 0;
    outputTokens += usage?.completion_tokens ?? 0;

    const message = (data.choices as Choice[] | undefined)?.[0]?.message;
    if (!message) break;

    if (message.content) {
      fullText += message.content;
      onText?.(message.content);
    }

    const toolCalls = message.tool_calls ?? [];
    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: toolCalls });

    if (toolCalls.length === 0) break;

    for (const call of toolCalls) {
      const name = call.function?.name ?? "";
      onToolCall?.(name);

      // A model that emits malformed arguments gets told so, and can correct it
      // on the next round.
      let args: Record<string, unknown> = {};
      let parseError: string | undefined;
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error);
      }

      let content: string;
      if (parseError) {
        content = `Those arguments were not valid JSON (${parseError}). Send them again.`;
      } else {
        const outcome = await runTool(name, args, context);
        content = outcome.message;
        if (outcome.patches.length > 0) {
          // Fold now, so a patch that cannot apply is a tool error the model can
          // correct on the next round rather than a dead turn at the end.
          const rejection = await onPatches?.(outcome.patches);
          if (rejection) content = `That change was rejected: ${rejection}`;
          else patches.push(...outcome.patches);
        }
      }

      messages.push({ role: "tool", tool_call_id: call.id ?? name, content });
    }
  }

  return { text: fullText, patches, inputTokens, outputTokens };
}
