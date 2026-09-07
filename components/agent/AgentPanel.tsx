"use client";

import * as React from "react";
import {
  X,
  Sparkles,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  HelpCircle,
  ArrowRight,
  ArrowUp,
  Plus,
  Send,
  ListChecks,
  Paperclip,
  Stethoscope,
  Building2,
  Laptop,
  Palette,
  Columns,
  GitBranch,
  LayoutDashboard,
} from "lucide-react";
import type { Config, ConfigPatch, ImpactSummary } from "@/lib/config/types";
import { ThinkingOrb } from "thinking-orbs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { needsConfirmation } from "@/lib/config/review";
import { readJsonLines } from "@/lib/agent/stream";
import { ConfigDiff } from "./ConfigDiff";
import { ConnectPrompt } from "./ConnectPrompt";
import { ConnectorsPanel } from "./ConnectorsPanel";
import { useConnectors } from "./useConnectors";
import { rollbackAction } from "@/app/(app)/settings/history/actions";
import { cn } from "@/lib/utils";

function AudioWaveformIcon({ className = "h-3.5 w-3.5 text-zinc-400" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M3 8a1 1 0 011 1v2a1 1 0 11-2 0V9a1 1 0 011-1zm3-3a1 1 0 011 1v8a1 1 0 11-2 0V6a1 1 0 011-1zm4-3a1 1 0 011 1v14a1 1 0 11-2 0V3a1 1 0 011-1zm4 3a1 1 0 011 1v8a1 1 0 11-2 0V6a1 1 0 011-1zm3 3a1 1 0 011 1v2a1 1 0 11-2 0V9a1 1 0 011-1z" />
    </svg>
  );
}

export interface PlanStep {
  text: string;
  status: "pending" | "active" | "done";
}

interface Turn {
  role: "user" | "assistant";
  text: string;
  /** Filenames attached to a user turn (uploads already stored server-side). */
  files?: string[];
  plan?: PlanStep[];
  thinkingSteps?: string[];
  questions?: string[];
  connect?: { provider: string; label: string; reason: string };
}

interface PendingPatch {
  patches: ConfigPatch[];
  impact: ImpactSummary;
}

interface AppliedPatch extends PendingPatch {
  /** The version it created, so undo knows what to roll back to. */
  version: number;
}

/**
 * A change applies on its own unless it destroys something or leaves the
 * building. Asking about a screen the agent just built is friction with no
 * decision behind it; asking before a field with records in it disappears is
 * the whole point of the diff.
 */

export interface AgentPanelProps {
  config: Config;
  counts: Record<string, number>;
  canEditConfig: boolean;
  initialPrompt?: string;
  className?: string;
  hideHeader?: boolean;
  onClose?: () => void;
  onApplied: (newConfig?: Config, firstViewId?: string | null, promptText?: string) => void;
  onPromptSent?: (prompt: string) => void;
}

/**
 * The agent's checklist for the turn. The agent posts it before it starts and
 * updates it as it goes, so the ticks track work that actually happened — this
 * is a view of the agent's own `update_plan` calls, not a progress animation.
 */
function PlanBlock({ steps }: { steps: PlanStep[] }) {
  const done = steps.filter((step) => step.status === "done").length;

  return (
    <div className="mb-2 w-full rounded-2xl border border-zinc-800/90 bg-[#121215] p-4 text-left space-y-3 shadow-xl">
      <div className="flex items-center justify-between text-xs font-mono text-zinc-400 pb-2.5 border-b border-zinc-800/60">
        <div className="flex items-center gap-2">
          <ListChecks size={14} className="text-purple-400" />
          <span className="font-semibold text-zinc-200">Plan</span>
        </div>
        <span className="tabular-nums text-zinc-500">
          {done}/{steps.length}
        </span>
      </div>

      <div className="space-y-2.5 text-xs">
        {steps.map((step, index) => (
          <div key={index} className="flex items-center gap-2.5">
            {step.status === "done" ? (
              <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
            ) : step.status === "active" ? (
              <ThinkingOrb state="working" size={20} theme="dark" className="shrink-0" />
            ) : (
              <div className="h-3.5 w-3.5 rounded-full border border-zinc-700 shrink-0" />
            )}
            <span
              className={cn(
                step.status === "done" && "text-zinc-400",
                step.status === "active" && "text-white font-medium",
                step.status === "pending" && "text-zinc-600",
              )}
            >
              {step.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Antigravity-Style Collapsible Thinking / Reasoning Block.
 */
function ThinkingBlock({
  steps = [],
  isLive,
  liveElapsed,
}: {
  steps?: string[];
  isLive: boolean;
  liveElapsed: number;
}) {
  const [isOpen, setIsOpen] = React.useState(isLive);

  // Auto-expand when live, allow manual toggle
  React.useEffect(() => {
    if (isLive) setIsOpen(true);
  }, [isLive]);

  if (!isLive && (!steps || steps.length === 0)) return null;

  return (
    <div className="mb-2 w-full overflow-hidden rounded-2xl border border-zinc-800/90 bg-[#121215] shadow-xl transition-all">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isLive ? (
            <div className="flex items-center gap-1.5 text-purple-400">
              <ThinkingOrb state="working" size={20} theme="dark" className="shrink-0" />
              <span className="text-[11px] font-semibold">Thinking... ({liveElapsed}s)</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-zinc-400">
              <CheckCircle2 size={12} className="text-zinc-500" />
              <span className="text-[11px]">
                Reasoned in {Math.max(1, liveElapsed || 1)}s ({steps.length} steps)
              </span>
            </div>
          )}
        </div>
        {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {isOpen && (
        <div className="border-t border-zinc-800/60 px-4 py-3 font-mono text-[11px] text-zinc-400 space-y-1.5 animate-in fade-in duration-150">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-start gap-2 leading-tight">
              <span className="text-zinc-600 select-none">›</span>
              <span className="text-zinc-300">{step}</span>
            </div>
          ))}
          {isLive && (
            <div className="flex items-center gap-2 text-purple-400/80 pt-1">
              <ThinkingOrb state="working" size={20} theme="dark" className="shrink-0" />
              <span className="italic">Synthesizing CRM changes...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentPanel({
  config,
  counts,
  canEditConfig,
  initialPrompt,
  className,
  hideHeader = false,
  onClose,
  onApplied,
  onPromptSent,
}: AgentPanelProps) {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [input, setInput] = React.useState(initialPrompt ?? "");
  const [attachments, setAttachments] = React.useState<{ id: string; filename: string }[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  const [streaming, setStreaming] = React.useState(false);
  const [thinkingSeconds, setThinkingSeconds] = React.useState(0);
  const [pending, setPending] = React.useState<PendingPatch | null>(null);
  const [applied, setApplied] = React.useState<AppliedPatch | null>(null);
  const [applying, setApplying] = React.useState(false);
  const [undoing, setUndoing] = React.useState(false);
  const [appliedSuccess, setAppliedSuccess] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [budget, setBudget] = React.useState<{ remaining: number; fraction: number } | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const scrollAreaRef = React.useRef<HTMLDivElement>(null);
  /** Whether the conversation is pinned to the bottom. The user unpins it by
      scrolling up; returning to the bottom re-pins. */
  const pinnedRef = React.useRef(true);
  const lastPromptRef = React.useRef<string>("");
  const connectors = useConnectors();

  // Actions elsewhere in the Studio can hand a concrete task to an already
  // open panel. Keep the composer in sync and put the cursor where the user
  // expects it instead of only reading the prompt on first mount.
  React.useEffect(() => {
    if (!initialPrompt) return;
    setInput(initialPrompt);
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [initialPrompt]);

  // Thinking timer
  React.useEffect(() => {
    let timer: NodeJS.Timeout;
    if (streaming) {
      setThinkingSeconds(0);
      timer = setInterval(() => {
        setThinkingSeconds((s) => s + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [streaming]);

  // Follow the conversation while it streams, but never yank the reader:
  // once scrolled up, auto-scroll stays off until they return to the bottom.
  // Streaming tokens use instant jumps; only turn boundaries smooth-scroll.
  const handleScrollAreaScroll = React.useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  React.useEffect(() => {
    if (pinnedRef.current) {
      endRef.current?.scrollIntoView({ block: "end", behavior: streaming ? "auto" : "smooth" });
    }
  }, [turns, pending, streaming]);

  /** Images ride to the model downscaled; data files go through as-is. */
  const prepareFile = (file: File): Promise<{ filename: string; mimeType: string; data: string } | null> => {
    return new Promise((resolve) => {
      if (file.type.startsWith("image/")) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          resolve({
            filename: file.name.replace(/\.[^.]+$/, "") + ".jpg",
            mimeType: "image/jpeg",
            data: dataUrl.split(",")[1] ?? "",
          });
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        img.src = url;
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === "string" ? reader.result : "";
          resolve({ filename: file.name, mimeType: file.type || "text/plain", data: result.split(",")[1] ?? "" });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      }
    });
  };

  /** Uploads at attach time, so sending is one request and typing never waits. */
  const attachFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files).slice(0, Math.max(0, 4 - attachments.length))) {
        const prepared = await prepareFile(file);
        if (!prepared || !prepared.data) {
          setError(`"${file.name}" could not be read.`);
          continue;
        }
        const response = await fetch("/api/files", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(prepared),
        });
        if (!response.ok) {
          setError((await response.text()) || `"${file.name}" could not be uploaded.`);
          continue;
        }
        const saved = (await response.json()) as { id: string; filename: string };
        setAttachments((current) => [...current, { id: saved.id, filename: saved.filename }]);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const send = async (prompt: string) => {
    if ((!prompt.trim() && attachments.length === 0) || streaming || uploading) return;
    // Attachments alone still need words for the turn — say what they are.
    const effectivePrompt = prompt.trim() || "What do you see in these attachments?";
    lastPromptRef.current = effectivePrompt;
    onPromptSent?.(effectivePrompt);
    setError(null);
    setPending(null);
    setApplied(null);
    setAppliedSuccess(false);
    setInput("");
    const attachedIds = attachments.map((a) => a.id);
    const attachedNames = attachments.map((a) => a.filename);
    setAttachments([]);
    setTurns((current) => [
      ...current,
      { role: "user", text: effectivePrompt, files: attachedNames.length > 0 ? attachedNames : undefined },
      { role: "assistant", text: "", thinkingSteps: [] },
    ]);
    // A new turn re-pins to the bottom so the user follows it from the start.
    pinnedRef.current = true;
    setStreaming(true);

    try {
      // What was said before this prompt, so follow-ups have something to
      // follow. Text only — tool calls stay on the server.
      const history = turns
        .filter((turn) => turn.text.trim())
        .slice(-20)
        .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 8000) }));

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: effectivePrompt, history, files: attachedIds }),
      });

      if (!response.ok || !response.body) {
        throw new Error((await response.text()) || "The agent could not be reached.");
      }

      type AgentEvent =
            | { type: "text"; delta: string }
            | { type: "thinking"; steps: string[] }
            | { type: "plan"; steps: PlanStep[] }
            | { type: "questions"; questions: string[] }
            | { type: "patch"; patches: ConfigPatch[]; impact: ImpactSummary }
            | { type: "budget"; remaining: number; fraction: number }
            | { type: "connect_required"; provider: string; label: string; reason: string }
            | { type: "error"; message: string };
      for await (const event of readJsonLines<AgentEvent>(response.body)) {
          if (event.type === "thinking") {
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  thinkingSteps: event.steps,
                };
              }
              return next;
            });
          } else if (event.type === "plan") {
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = { ...last, plan: event.steps };
              }
              return next;
            });
          } else if (event.type === "questions") {
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  questions: event.questions,
                };
              }
              return next;
            });
          } else if (event.type === "text") {
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = { ...last, text: last.text + event.delta };
              }
              return next;
            });
          } else if (event.type === "patch") {
            const incoming = { patches: event.patches, impact: event.impact };
            if (canEditConfig && !needsConfirmation(event.impact)) {
              // Nothing to decide: build it, and show what was built.
              await apply(incoming);
            } else {
              setPending(incoming);
            }
          } else if (event.type === "budget") {
            setBudget({ remaining: event.remaining, fraction: event.fraction });
          } else if (event.type === "connect_required") {
            const { provider, label, reason } = event;
            setTurns((current) => [
              ...current,
              { role: "assistant", text: "", connect: { provider, label, reason } },
            ]);
          } else if (event.type === "error") {
            setError(event.message);
          }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong reaching the agent.");
    } finally {
      setStreaming(false);
    }
  };

  const apply = async (patch: PendingPatch) => {
    setApplying(true);
    setError(null);
    try {
      const response = await fetch("/api/agent/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patches: patch.patches }),
      });
      if (!response.ok) throw new Error((await response.text()) || "Those changes could not be applied.");
      const result = (await response.json()) as {
        version: number;
        summary: string;
        config?: Config;
        firstViewId?: string | null;
      };

      setPending(null);
      setApplied({ ...patch, version: result.version });
      setAppliedSuccess(true);
      onApplied(result.config, result.firstViewId, lastPromptRef.current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Those changes could not be applied.");
    } finally {
      setApplying(false);
    }
  };

  /** Rolls the workspace back to the version before the one just applied. */
  const undo = async () => {
    // Version 1 is the seeded default: there is nothing behind it to restore.
    if (!applied || applied.version <= 1) return;
    setUndoing(true);
    setError(null);
    try {
      const result = await rollbackAction(applied.version - 1);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setApplied(null);
      setAppliedSuccess(false);
      onApplied(undefined, null, lastPromptRef.current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be undone.");
    } finally {
      setUndoing(false);
    }
  };

  const starterPrompts = [
    {
      label: "Clinic & Triage",
      icon: Stethoscope,
      prompt: "Build a clinic CRM with patient triage, appointment calendar, and medical records",
    },
    {
      label: "Commercial Real Estate",
      icon: Building2,
      prompt: "Create a real estate CRM with property listings, lease contracts, and escrow stages",
    },
    {
      label: "B2B SaaS Sales Engine",
      icon: Laptop,
      prompt: "Build a B2B SaaS CRM with ARR metrics, enterprise deal stages, and lead qualification",
    },
    {
      label: "Creative Agency Sprints",
      icon: Palette,
      prompt: "Make an agency CRM with client retainers, deliverables, and sprint Kanban boards",
    },
  ];

  /**
   * Follow-ups grounded in the CRM that actually exists — offered once the
   * workspace has content, so the buttons suggest what to edit next in
   * *this* CRM rather than generic archetypes. Every prompt maps to a real
   * agent tool (see docs/AGENT-TOOLS.md): create_view, create_pipeline,
   * add_field, create_screen, set_theme.
   */
  const followUpPrompts = React.useMemo(() => {
    const suggestions: { label: string; prompt: string; icon: typeof Plus }[] = [];
    const objects = config.objects ?? [];
    const views = config.views ?? [];
    const screens = config.screens ?? [];
    const pipelines = config.pipelines ?? [];
    if (objects.length === 0) return suggestions;

    const pluralOf = (key: string) => objects.find((o) => o.key === key)?.labelPlural ?? key;
    const hasKanban = (key: string) => views.some((v) => v.objectKey === key && v.renderer === "kanban");
    const hasPipeline = (key: string) => pipelines.some((p) => p.objectKey === key);

    // Busiest object first — record counts say what this CRM is about.
    const byActivity = [...objects].sort((a, b) => (counts[b.key] ?? 0) - (counts[a.key] ?? 0));
    const focus = byActivity[0];
    if (!focus) return suggestions;

    // A board for the record type that still lives in a table.
    const boardless = byActivity.find((o) => !hasKanban(o.key));
    if (boardless) {
      const stageField = boardless.fields.find((f) => f.type === "select")?.key ?? "stage";
      suggestions.push({
        label: `${boardless.labelPlural} board`,
        prompt: `Create a Kanban view for ${boardless.labelPlural} grouped by ${stageField}`,
        icon: Columns,
      });
    }

    // Stages for the focus object when nothing tracks its flow yet.
    if (!hasPipeline(focus.key)) {
      suggestions.push({
        label: `${focus.label} pipeline`,
        prompt: `Create a pipeline with stages for ${focus.labelPlural}`,
        icon: GitBranch,
      });
    }

    // The field this CRM is missing: a priority picklist, else a date.
    const missingPriority = byActivity.find((o) => !o.fields.some((f) => f.key.includes("priority")));
    if (missingPriority) {
      suggestions.push({
        label: `Priority on ${missingPriority.labelPlural.toLowerCase()}`,
        prompt: `Add a priority select field (Low, Medium, High) to ${missingPriority.labelPlural}`,
        icon: Plus,
      });
    } else {
      const missingDate = byActivity.find(
        (o) => !o.fields.some((f) => f.type === "date" || f.type === "datetime"),
      );
      if (missingDate) {
        suggestions.push({
          label: `Follow-up date`,
          prompt: `Add a follow-up date field to ${missingDate.labelPlural}`,
          icon: Plus,
        });
      }
    }

    // A screen, or a fresh coat of paint once screens exist.
    if (screens.length === 0) {
      suggestions.push({
        label: `Overview screen`,
        prompt: `Build an overview screen for ${config.brand?.name ?? "the workspace"} with key metrics for ${pluralOf(focus.key)}`,
        icon: LayoutDashboard,
      });
    } else {
      suggestions.push({
        label: `Restyle workspace`,
        prompt: `Refresh the workspace theme with a new accent and density`,
        icon: Palette,
      });
    }

    return suggestions.slice(0, 4);
  }, [config, counts]);

  const hasWorkspace = (config.screens?.length ?? 0) + (config.views?.length ?? 0) > 0;
  const emptyPrompts = hasWorkspace && followUpPrompts.length > 0 ? followUpPrompts : starterPrompts;
  const emptyHeading = hasWorkspace && followUpPrompts.length > 0 ? "Next steps" : "Starter Archetypes";

  const lowBudget = budget !== null && budget.fraction >= 0.8;

  return (
    <aside
      className={cn(
        "flex w-80 md:w-96 lg:w-[420px] shrink-0 flex-col border-l border-zinc-800/80 bg-[#0c0c0e] text-zinc-100 select-none overflow-hidden",
        className
      )}
      aria-label="Agent"
    >
      {/* Header */}
      {!hideHeader && (
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800/80 px-4 bg-[#0c0c0e]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800 text-white shadow-sm">
              <Sparkles size={14} className="text-purple-400" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-xs font-semibold text-white tracking-tight">AI Agent</h2>
                <span className="rounded-full bg-emerald-950/70 border border-emerald-800/50 px-1.5 py-0.5 text-[9px] font-mono text-emerald-400">
                  Gemini 3.7 Flash
                </span>
              </div>
              <p className="text-[10px] font-mono text-zinc-500">Autonomous CRM Vibe-Coder</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {turns.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setTurns([]);
                  setPending(null);
                  setApplied(null);
                }}
                className="rounded-lg px-2 py-1 text-[10px] font-mono text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors"
                title="Clear chat history"
              >
                Clear
              </button>
            )}

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </header>
      )}

      {/* Connectors Banner */}
      <ConnectorsPanel
        connectors={connectors.connectors}
        loading={connectors.loading}
        busy={connectors.busy}
        error={connectors.error}
        onConnect={connectors.connect}
        onDisconnect={connectors.disconnect}
        onSaveCredentials={connectors.saveCredentials}
      />

      {/* Conversation area */}
      <div ref={scrollAreaRef} onScroll={handleScrollAreaScroll} className="no-scrollbar flex-1 overflow-y-auto p-4">
        {turns.length === 0 ? (
          <div className="flex flex-col gap-2.5 py-1">
            <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 px-0.5">
              {emptyHeading}
            </p>
            <div className="grid grid-cols-1 gap-2">
              {emptyPrompts.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => void send(item.prompt)}
                    className="flex items-center justify-between rounded-xl border border-zinc-800/90 bg-[#131316] p-2.5 text-left text-xs text-zinc-300 hover:border-zinc-700 hover:text-white hover:bg-zinc-900/80 transition-all shadow-sm group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon size={14} className="text-zinc-500 group-hover:text-zinc-300 shrink-0 transition-colors" />
                      <span className="font-medium text-zinc-200 group-hover:text-white truncate">{item.label}</span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500 group-hover:text-zinc-400 shrink-0">Run ›</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {turns.map((turn, index) => {
              const isLastAssistant = turn.role === "assistant" && index === turns.length - 1;
              return (
                <div
                  key={index}
                  className={cn(
                    "text-sm flex flex-col w-full",
                    turn.role === "user" ? "items-end" : "items-start",
                  )}
                >
                  <span className="mb-1 text-xs font-mono text-zinc-400 uppercase tracking-wider">
                    {turn.role === "user" ? "You" : "AI Agent"}
                  </span>

                  <div
                    className={cn(
                      "p-3 rounded-2xl max-w-[95%] leading-relaxed w-full",
                      turn.role === "user"
                        ? "bg-zinc-800 border border-zinc-700 text-white rounded-tr-sm shadow-sm"
                        : "text-zinc-200 rounded-tl-sm",
                    )}
                  >
                    {/* Collapsible Antigravity Thinking Block */}
                    {turn.role === "assistant" && (
                      <ThinkingBlock
                        steps={turn.thinkingSteps}
                        isLive={streaming && isLastAssistant}
                        liveElapsed={thinkingSeconds}
                      />
                    )}

                    {/* The agent's own checklist, ticked off as it works */}
                    {turn.role === "assistant" && turn.plan && turn.plan.length > 0 && (
                      <PlanBlock steps={turn.plan} />
                    )}

                    {turn.connect ? (
                      <ConnectPrompt
                        provider={turn.connect.provider}
                        label={turn.connect.label}
                        reason={turn.connect.reason}
                        connected={
                          connectors.connectors.find((c) => c.provider === turn.connect!.provider)?.connected ?? false
                        }
                        account={connectors.connectors.find((c) => c.provider === turn.connect!.provider)?.account}
                        busy={connectors.busy === turn.connect.provider}
                        onConnect={connectors.connect}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-xs">
                        {turn.text || (streaming && isLastAssistant ? "Generating CRM architecture..." : "")}
                      </p>
                    )}

                    {turn.files && turn.files.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {turn.files.map((name) => (
                          <span
                            key={name}
                            className="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300"
                          >
                            <Paperclip size={10} aria-hidden />
                            <span className="max-w-[180px] truncate">{name}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Interactive Clarifying Questions / Follow-ups */}
                    {turn.questions && turn.questions.length > 0 && !streaming && (
                      <div className="mt-3 space-y-1.5 pt-2.5 border-t border-zinc-800/80">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                          <HelpCircle size={11} className="text-zinc-400" />
                          <span>Next steps & customizations:</span>
                        </p>
                        <div className="flex flex-col gap-1.5">
                          {turn.questions.map((q, qIdx) => (
                            <button
                              key={qIdx}
                              type="button"
                              onClick={() => void send(q)}
                              className="text-left text-xs text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 rounded-lg px-2.5 py-1.5 transition-all flex items-center justify-between group shadow-sm"
                            >
                              <span>{q}</span>
                              <ArrowRight
                                size={11}
                                className="text-zinc-500 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0 ml-1.5"
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Pending Patch Review */}
            {applied ? (
              <div className="space-y-2 pt-1 animate-in fade-in duration-200">
                <ConfigDiff
                  patches={applied.patches}
                  impact={applied.impact}
                  status={undoing ? "undoing" : "applied"}
                  onConfirm={() => undefined}
                  onDiscard={() => setApplied(null)}
                  onUndo={applied.version > 1 ? () => void undo() : undefined}
                />
              </div>
            ) : pending && canEditConfig ? (
              <div className="space-y-2 pt-1 animate-in fade-in duration-200">
                <ConfigDiff
                  patches={pending.patches}
                  impact={pending.impact}
                  status={applying ? "applying" : "ready"}
                  onConfirm={() => void apply(pending)}
                  onDiscard={() => setPending(null)}
                />
              </div>
            ) : applying ? (
              <div className="flex items-center gap-2 pt-1 text-xs text-zinc-400">
                <ThinkingOrb state="working" size={20} theme="dark" className="shrink-0" />
                <span>Building it…</span>
              </div>
            ) : pending ? (
              <p className="text-xs text-zinc-500">
                Your role can review changes but not apply them. Ask an owner or admin to confirm.
              </p>
            ) : null}

            {/* Applied Confirmation banner */}
            {appliedSuccess && (
              <div className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-xs text-zinc-200 shadow-md animate-in fade-in">
                <CheckCircle2 size={14} className="text-white" />
                <span>Changes applied live! View updated on your canvas.</span>
              </div>
            )}
          </div>
        )}

        {error ? (
          <p role="alert" className="mt-4 text-xs text-red-400 bg-red-950/40 border border-red-900/50 p-2.5 rounded-lg">
            {error}
          </p>
        ) : null}

        <div ref={endRef} />
      </div>

      {/* Input Prompt Box (Google AI Studio / ChatGPT Style matching Center) */}
      <form
        className="shrink-0 border-t border-zinc-800/80 bg-[#0c0c0e] p-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <div className="w-full relative group">
          {/* Ambient Glow on Focus */}
          <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-indigo-500/15 via-purple-500/20 to-blue-500/15 blur-lg opacity-40 group-focus-within:opacity-100 group-focus-within:blur-xl transition-all duration-300 pointer-events-none" />

          <div className="relative rounded-2xl border border-zinc-800/90 bg-[#121215] p-3 shadow-xl transition-all duration-200 group-focus-within:border-zinc-700">
            {attachments.length > 0 || uploading ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((a) => (
                  <span
                    key={a.id}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 py-1 pl-2 pr-1 text-[11px] text-zinc-200"
                  >
                    <span className="max-w-[160px] truncate">{a.filename}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((current) => current.filter((x) => x.id !== a.id))}
                      aria-label={`Remove ${a.filename}`}
                      className="rounded p-0.5 text-zinc-500 transition-colors hover:text-white"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                {uploading && <span className="py-1 text-[11px] text-zinc-500">Uploading…</span>}
              </div>
            ) : null}
            <textarea
              ref={composerRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={streaming ? "AI is reasoning..." : "Ask AI Agent anything or describe your CRM..."}
              rows={2}
              disabled={streaming}
              className="no-scrollbar w-full bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 outline-none resize-none leading-relaxed font-sans"
            />

            {/* Bottom Action Strip */}
            <div className="flex items-center justify-between pt-2 mt-1 border-t border-zinc-800/60">
              {/* Left: Templates Button */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setInput("Build a comprehensive CRM with deals, contacts, pipeline stages, and automated lead scoring")}
                  className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-[#18181c] px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-700 hover:text-white transition-colors"
                >
                  <Plus size={12} />
                  <span>Templates</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={streaming || uploading}
                  title="Attach an image or data file"
                  className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-[#18181c] px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-700 hover:text-white transition-colors disabled:opacity-40"
                >
                  <Paperclip size={12} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.csv,.txt"
                  multiple
                  className="hidden"
                  onChange={(e) => void attachFiles(e.target.files)}
                />
              </div>

              {/* Right: Waveform & Solid Send Button (↑) */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setInput("Analyze current CRM schema and suggest custom agents")}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-[#18181c] text-zinc-400 hover:border-zinc-700 hover:text-white transition-colors"
                  title="Audio input"
                >
                  <AudioWaveformIcon className="h-3.5 w-3.5 text-zinc-400" />
                </button>

                <button
                  type="submit"
                  disabled={streaming || uploading || (!input.trim() && attachments.length === 0)}
                  className="flex h-7 w-7 items-center justify-center rounded-xl bg-white text-black transition-all hover:bg-zinc-200 disabled:opacity-30 disabled:pointer-events-none shadow-md active:scale-95"
                  title="Send to AI Agent"
                >
                  {streaming ? <ThinkingOrb state="working" size={20} theme="light" aria-hidden="true" /> : <ArrowUp size={14} strokeWidth={2.5} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {lowBudget && budget && (
          <p className="mt-2 text-[10px] font-mono text-amber-400">
            Token budget: {budget.remaining.toLocaleString()} remaining ({Math.round(budget.fraction * 100)}% used)
          </p>
        )}
      </form>
    </aside>
  );
}
