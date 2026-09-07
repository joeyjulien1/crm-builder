import { AGENT_TOOLS, runTool, type ToolContext } from "./tools";
import type { AgentImage } from "./execute";
import type { ConfigPatch } from "@/lib/config/types";

/**
 * Gemini speaks a subset of OpenAPI, not JSON Schema. Anything it does not
 * understand has to be stripped rather than sent and hoped for.
 */
function toGeminiSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "additionalProperties" || key === "$schema") continue;
    clean[key] = toGeminiSchema(value);
  }
  return clean;
}

export interface GeminiTurnResult {
  text: string;
  patches: ConfigPatch[];
  inputTokens: number;
  outputTokens: number;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
}

interface GeminiContent {
  role?: string;
  parts?: GeminiPart[];
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Long enough to ride out a rate limit, short enough that a turn still ends. */
const MAX_BACKOFF_MS = 65_000;

function backoffMs(attempt: number): number {
  return [1_000, 4_000, 10_000, 20_000][attempt] ?? 20_000;
}

/**
 * A rate-limited response says how long to wait. Honouring that beats guessing:
 * on the free tier the limit is a handful of requests a minute, and a tool loop
 * that builds a whole CRM will hit it.
 */
function retryAfterMs(body: unknown): number | undefined {
  const details = (body as { error?: { details?: { retryDelay?: string }[] } })?.error?.details;
  if (!Array.isArray(details)) return undefined;

  for (const detail of details) {
    const seconds = Number(/^([\d.]+)s$/.exec(detail?.retryDelay ?? "")?.[1]);
    // A second of slack, so the retry lands after the window rather than on it.
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000 + 1_000, MAX_BACKOFF_MS);
  }
  return undefined;
}

async function callGemini(params: {
  apiKey: string;
  model: string;
  payload: unknown;
  timeoutMs: number;
  attempts: number;
}): Promise<Record<string, unknown>> {
  const { apiKey, model, payload, timeoutMs, attempts } = params;
  let lastError = "";
  let waitMs = 0;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs || backoffMs(attempt - 1)));
    }
    waitMs = 0;

    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
    } catch (error) {
      // Timeouts and network faults are worth retrying; both land here.
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }

    if (response.ok) return (await response.json()) as Record<string, unknown>;

    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    lastError = `${response.status} ${body.error?.message ?? response.statusText}`;
    if (!RETRYABLE.has(response.status)) break;
    waitMs = retryAfterMs(body) ?? 0;
  }

  throw new Error(`Gemini (${model}): ${lastError}`);
}

/**
 * One turn against Gemini, running the tool loop to completion rather than
 * stopping after a fixed couple of rounds. Building a CRM takes many calls —
 * read the schema, add the fields, then build the pipeline and views over them
 * — so the loop has to be allowed to finish the job.
 */
export async function runGeminiTurn(params: {
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
}): Promise<GeminiTurnResult> {
  const { apiKey, model, system, context, maxRounds, timeoutMs, onText, onToolCall, onPatches } = params;

  const functionDeclarations = AGENT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.input_schema),
  }));

  const contents: GeminiContent[] = params.messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.text }],
  }));

  // Images ride on the latest user message only; history stays text.
  const lastUser = [...contents].reverse().find((entry) => entry.role === "user");
  const inlineImages = (params.images ?? []).filter((image) => image.kind === "image" && image.data);
  if (lastUser?.parts && inlineImages.length > 0) {
    lastUser.parts.push(
      ...inlineImages.map((image) => ({
        inlineData: { mimeType: image.mimeType, data: image.data },
      })),
    );
  }

  const patches: ConfigPatch[] = [];
  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for (let round = 0; round < maxRounds; round++) {
    const data = await callGemini({
      apiKey,
      model,
      timeoutMs,
      attempts: 4,
      payload: {
        system_instruction: { parts: [{ text: system }] },
        contents,
        tools: [{ function_declarations: functionDeclarations }],
      },
    });

    const usage = data.usageMetadata as { promptTokenCount?: number; totalTokenCount?: number } | undefined;
    const prompt = usage?.promptTokenCount ?? 0;
    inputTokens += prompt;
    // Thinking tokens are billed as output and are most of the cost on 3.x.
    outputTokens += Math.max(0, (usage?.totalTokenCount ?? 0) - prompt);

    const candidate = (data.candidates as { content?: GeminiContent }[] | undefined)?.[0];
    const content = candidate?.content;
    if (!content) break;

    const parts = content.parts ?? [];
    const toolResponses: unknown[] = [];

    for (const part of parts) {
      if (part.text) {
        fullText += part.text;
        onText?.(part.text);
      }
      if (part.functionCall) {
        const { name, args } = part.functionCall;
        onToolCall?.(name);
        const outcome = await runTool(name, args ?? {}, context);

        let message = outcome.message;
        if (outcome.patches.length > 0) {
          // Fold now, so a patch that cannot apply is a tool error the model can
          // correct on the next round rather than a dead turn at the end.
          const rejection = await onPatches?.(outcome.patches);
          if (rejection) message = `That change was rejected: ${rejection}`;
          else patches.push(...outcome.patches);
        }

        toolResponses.push({ functionResponse: { name, response: { content: message } } });
      }
    }

    if (toolResponses.length === 0) break;

    // The whole content is echoed back, thought signatures included — Gemini 3
    // needs them to keep its reasoning across tool rounds.
    contents.push(content);
    contents.push({ role: "user", parts: toolResponses as GeminiPart[] });
  }

  return { text: fullText, patches, inputTokens, outputTokens };
}
