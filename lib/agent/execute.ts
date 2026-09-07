import Anthropic from "@anthropic-ai/sdk";
import { withTenant } from "@/lib/db/client";
import { agentFailures } from "@/lib/db/schema";
import { applyPatches, PatchError } from "@/lib/config/patch";
import { computeImpact } from "@/lib/config/impact";
import type { Config, ConfigPatch, ImpactSummary } from "@/lib/config/types";
import { assertWithinBudget, getBudget, recordTurn, type BudgetState } from "./budget";
import { systemPrompt } from "./prompt";
import { getUpload } from "@/lib/files";
import {
  AGENT_TOOLS,
  runTool,
  type ConnectRequest,
  type ImportProposal,
  type PlanStep,
  type ToolContext,
} from "./tools";
import { runGeminiTurn } from "./gemini";
import { runOpenRouterTurn } from "./openrouter";

const MAX_TOKENS = 16000;
const MAX_TOOL_ROUNDS = 12;

/** Gemini 3.x with the full tool set regularly takes 20s+ on the first round. */
const REQUEST_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 120_000);

/** A turn that could not run at all: no key, a bad key, a provider outage. */
export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

export interface AgentMessage {
  role: "user" | "assistant";
  text: string;
}

/**
 * A user upload resolved to bytes by the route. History stays text-only;
 * only the latest user message carries images, one turn at a time.
 */
export interface AgentImage {
  fileId: string;
  filename: string;
  mimeType: string;
  /** Base64 body for the provider's vision parts. Empty for data files. */
  data: string;
  /** Data files travel by id (the import tools read them); no bytes inline. */
  kind: "image" | "data";
}

/** Vision allowlist, mirroring lib/files.ts — the Anthropic SDK types it narrow. */
const VISION_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type VisionMimeType = (typeof VISION_MIME_TYPES)[number];

export interface AgentTurnInput {
  tenantId: string;
  userId?: string;
  config: Config;
  counts: Record<string, number>;
  /** Earlier turns, so a follow-up like "now add a board for that" means something. */
  history: AgentMessage[];
  prompt: string;
  /** Uploads attached to this message, resolved to bytes by the route. */
  images?: AgentImage[];
  onText?: (delta: string) => void;
  onThinking?: (steps: string[]) => void;
  onPlan?: (steps: PlanStep[]) => void;
  sampleImportFile?: ToolContext["sampleImportFile"];
  connections?: ToolContext["connections"];
}

export interface AgentTurnResult {
  text: string;
  thinkingSteps?: string[];
  /** The agent's own checklist for the turn, if it posted one. */
  plan?: PlanStep[];
  /** Follow-ups the agent offered, shown as buttons. */
  suggestions?: string[];
  patches: ConfigPatch[];
  impact?: ImpactSummary;
  importProposal?: ImportProposal;
  /** Set when the agent asked the user to connect a third-party account. */
  connectRequest?: ConnectRequest;
  history: AgentMessage[];
  budget: BudgetState;
  /** Set when the agent could not produce a patch the config would accept. */
  failure?: string;
}

const PROVIDER_KINDS = ["anthropic", "gemini", "openrouter"] as const;
type ProviderKind = (typeof PROVIDER_KINDS)[number];

interface Provider {
  kind: ProviderKind;
  model: string;
  apiKey: string;
}

/**
 * Which model actually runs. Chosen once, explicitly — never a silent cascade,
 * because a cascade hides a broken key behind output that looks like it worked.
 */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env): Provider {
  const keys: Record<ProviderKind, string | undefined> = {
    anthropic: env.ANTHROPIC_API_KEY?.trim(),
    gemini: env.GEMINI_API_KEY?.trim(),
    openrouter: env.OPENROUTER_API_KEY?.trim(),
  };

  const models: Record<ProviderKind, string> = {
    anthropic: env.AGENT_MODEL?.trim() || "claude-opus-5",
    gemini: env.GEMINI_MODEL?.trim() || "gemini-3.7-flash",
    openrouter: env.OPENROUTER_MODEL?.trim() || "z-ai/glm-5.2:free",
  };

  const raw = env.AGENT_PROVIDER?.trim().toLowerCase();
  const requested = PROVIDER_KINDS.find((candidate) => candidate === raw);

  if (raw && !requested) {
    throw new AgentError(`AGENT_PROVIDER is ${raw}. It must be one of ${PROVIDER_KINDS.join(", ")}.`);
  }

  const kind = requested ?? PROVIDER_KINDS.find((candidate) => keys[candidate]);

  if (!kind) {
    throw new AgentError(
      "No model is configured. Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY — with a matching AGENT_PROVIDER — and restart the server.",
    );
  }

  const apiKey = keys[kind];
  if (!apiKey) {
    const variable = kind === "anthropic" ? "ANTHROPIC_API_KEY" : `${kind.toUpperCase()}_API_KEY`;
    throw new AgentError(`AGENT_PROVIDER is ${kind}, but ${variable} is not set.`);
  }

  return { kind, apiKey, model: models[kind] };
}

/** What the user sees while a tool runs. Plain language, never schema terms. */
const TOOL_LABELS: Record<string, string> = {
  get_config: "Reading the current configuration",
  get_schema_summary: "Reading objects, fields and record counts",
  list_connections: "Checking connected accounts",
  request_connection: "Asking for an account connection",
  add_field: "Adding a field",
  update_field: "Updating a field",
  remove_field: "Removing a field",
  create_relation: "Linking two objects",
  reorder_fields: "Reordering fields",
  create_view: "Building a view",
  update_view: "Updating a view",
  delete_view: "Deleting a view",
  create_pipeline: "Building a pipeline",
  update_pipeline: "Updating a pipeline",
  create_automation: "Creating an automation",
  update_automation: "Updating an automation",
  set_automation_enabled: "Switching an automation on or off",
  propose_import_mapping: "Reading the file's columns",
  apply_import: "Staging the import",
  customize_brand: "Setting the workspace name",
  customize_object: "Renaming an object",
  add_custom_agent: "Adding an assistant",
  remove_custom_agent: "Removing an assistant",
};

/**
 * One turn. Runs the configured model's tool loop, folds each staged patch into
 * a working config as it goes so later steps can build on earlier ones, and
 * computes the impact of the set. Nothing here invents a change the model did
 * not make: a turn that fails, fails visibly.
 */
export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const { tenantId, config, counts } = input;

  const provider = resolveProvider();

  // Assert the tenant's token budget before spending any of it.
  const budget = await withTenant(tenantId, (db) => assertWithinBudget(db, tenantId));
  const attached = input.images ?? [];
  const system =
    systemPrompt(config, counts) +
    (attached.length > 0
      ? `\n\nFiles the user attached to this message:\n${attached
          .map((file) =>
            file.kind === "image"
              ? `- ${file.filename} (image, visible in this message, file id: ${file.fileId})`
              : `- ${file.filename} (data file, file id: ${file.fileId} — read it with propose_import_mapping when the user asks to import it)`,
          )
          .join("\n")}\nWhen the user asks to use one — e.g. as the workspace logo — pass its file id to the matching tool (customize_brand logo_file_id). Never invent file ids.`
      : "");

  let importProposal: ImportProposal | undefined;
  let connectRequest: ConnectRequest | undefined;
  let plan: PlanStep[] | undefined;
  let suggestions: string[] | undefined;

  // Advances as patches stage, so get_schema_summary mid-turn shows what the
  // agent has already staged, and a pipeline can reference a field just added.
  let workingConfig = config;

  const context: ToolContext = {
    config,
    counts,
    sampleImportFile: input.sampleImportFile,
    connections: input.connections,
    resolveUploadFile: (fileId) =>
      withTenant(tenantId, async (db) => {
        const row = await getUpload(db, tenantId, fileId);
        if (!row) return null;
        return { id: row.id, filename: row.filename, mimeType: row.mimeType, kind: row.kind };
      }),
    onImportProposal: (proposal) => {
      importProposal = proposal;
    },
    onConnectRequest: (request) => {
      connectRequest = request;
    },
    onPlan: (steps) => {
      plan = steps;
      input.onPlan?.(steps);
    },
    onSuggestions: (offered) => {
      suggestions = offered;
    },
  };

  const thinkingSteps: string[] = [];
  const noteToolCall = (name: string) => {
    const label = TOOL_LABELS[name] ?? name;
    if (thinkingSteps[thinkingSteps.length - 1] !== label) {
      thinkingSteps.push(label);
      input.onThinking?.([...thinkingSteps]);
    }
  };

  /** Returns a rejection message for the model, or undefined when it applied. */
  const foldPatches = async (staged: ConfigPatch[]): Promise<string | undefined> => {
    try {
      workingConfig = applyPatches(workingConfig, staged);
      context.config = workingConfig;
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  const messages: AgentMessage[] = [...input.history, { role: "user", text: input.prompt }];

  let text = "";
  let patches: ConfigPatch[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  const shared = {
    apiKey: provider.apiKey,
    model: provider.model,
    system,
    messages,
    images: attached,
    context,
    onText: input.onText,
    onToolCall: noteToolCall,
    onPatches: foldPatches,
  };

  try {
    const result =
      provider.kind === "gemini"
        ? await runGeminiTurn({ ...shared, maxRounds: MAX_TOOL_ROUNDS, timeoutMs: REQUEST_TIMEOUT_MS })
        : provider.kind === "openrouter"
          ? await runOpenRouterTurn({ ...shared, maxRounds: MAX_TOOL_ROUNDS, timeoutMs: REQUEST_TIMEOUT_MS })
          : await runAnthropicTurn(shared);

    text = result.text;
    patches = result.patches;
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logFailure(tenantId, "provider_error", input.prompt, { provider: provider.kind, error: message });
    throw new AgentError(
      `${provider.model} could not be reached: ${message}. Nothing has changed — try again in a moment.`,
    );
  }

  let failure: string | undefined;

  // Every patch already folded cleanly one at a time. This re-validates the set
  // as a whole, which is what gets written as one version.
  if (patches.length > 0) {
    try {
      applyPatches(config, patches);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logFailure(tenantId, "invalid_patch", input.prompt, { error: message, patches });
      patches = [];
      failure = message;
    }
  }

  const [impact, nextBudget] = await withTenant(tenantId, async (db) => {
    await recordTurn(db, tenantId, {
      userId: input.userId,
      model: provider.model,
      inputTokens,
      outputTokens,
      producedPatch: patches.length > 0,
    });

    return [
      patches.length > 0 ? await computeImpact(db, tenantId, config, patches) : undefined,
      await getBudget(db, tenantId),
    ] as const;
  });

  if (text) messages.push({ role: "assistant", text });

  return {
    text,
    thinkingSteps: thinkingSteps.length > 0 ? thinkingSteps : undefined,
    plan,
    suggestions,
    patches,
    impact,
    importProposal,
    connectRequest,
    history: messages,
    budget: nextBudget ?? budget,
    failure,
  };
}

async function runAnthropicTurn(params: {
  apiKey: string;
  model: string;
  system: string;
  messages: AgentMessage[];
  images?: AgentImage[];
  context: ToolContext;
  onText?: (delta: string) => void;
  onToolCall?: (name: string) => void;
  onPatches?: (patches: ConfigPatch[]) => Promise<string | undefined>;
}): Promise<{ text: string; patches: ConfigPatch[]; inputTokens: number; outputTokens: number }> {
  const client = new Anthropic({ apiKey: params.apiKey, timeout: REQUEST_TIMEOUT_MS });

  const inlineImages = (params.images ?? []).filter((image) => image.kind === "image" && image.data);
  const lastUserIndex = params.messages.map((message) => message.role).lastIndexOf("user");
  const messages: Anthropic.MessageParam[] = params.messages.map((message, index) => {
    if (message.role !== "user" || index !== lastUserIndex || inlineImages.length === 0) {
      return { role: message.role, content: message.text };
    }
    return {
      role: "user",
      content: [
        { type: "text" as const, text: message.text },
        ...inlineImages.map((image) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: (VISION_MIME_TYPES as readonly string[]).includes(image.mimeType)
              ? (image.mimeType as VisionMimeType)
              : ("image/jpeg" as VisionMimeType),
            data: image.data,
          },
        })),
      ],
    };
  });

  const patches: ConfigPatch[] = [];
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = client.messages.stream({
      model: params.model,
      max_tokens: MAX_TOKENS,
      system: params.system,
      tools: AGENT_TOOLS,
      messages,
    });

    if (params.onText) stream.on("text", (delta) => params.onText?.(delta));

    const response = await stream.finalMessage();
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    for (const block of response.content) {
      if (block.type === "text") text += block.text;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (toolUses.length === 0) break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      params.onToolCall?.(toolUse.name);
      const outcome = await runTool(
        toolUse.name,
        (toolUse.input ?? {}) as Record<string, unknown>,
        params.context,
      );

      let message = outcome.message;
      let isError = outcome.isError ?? false;
      if (outcome.patches.length > 0) {
        const rejection = await params.onPatches?.(outcome.patches);
        if (rejection) {
          message = `That change was rejected: ${rejection}`;
          isError = true;
        } else {
          patches.push(...outcome.patches);
        }
      }

      results.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: message,
        ...(isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: results });
  }

  return { text, patches, inputTokens, outputTokens };
}

async function logFailure(
  tenantId: string,
  kind: string,
  prompt: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await withTenant(tenantId, (db) =>
    db.insert(agentFailures).values({ tenantId, kind, prompt: prompt.slice(0, 4000), detail }),
  );
}

export { PatchError };
