"use client";

import * as React from "react";
import {
  Home,
  Bot,
  FolderKanban,
  Building2,
  Workflow,
  Plus,
  ArrowUp,
  Sparkles,
  Stethoscope,
  Laptop,
  Palette,
  PanelRightClose,
  ChevronLeft,
  CheckCircle2,
  ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewportMode } from "@/components/builder/FigmaCanvasFrame";
import { ThinkingOrb } from "thinking-orbs";
import { BorderBeam } from "border-beam";
import { Liquid } from "liquid-gooey";
import { ConfigDiff } from "@/components/agent/ConfigDiff";
import { readJsonLines } from "@/lib/agent/stream";
import { needsConfirmation } from "@/lib/config/review";
import type { ConfigPatch, ImpactSummary } from "@/lib/config/types";
import type { Config } from "@/lib/config/types";
import type { ProjectSummary } from "@/lib/projects";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { DynamicCrmCanvas } from "@/components/canvas/DynamicCrmCanvas";
import { ScreenSurface } from "@/components/screens/ScreenSurface";
import { ViewScreen } from "@/app/(app)/views/[viewId]/ViewScreen";
import { getBuilderCrmAction, type BuilderCrmState } from "@/app/(app)/actions";
import {
  addCustomAgentAction,
  openProjectAction,
  removeCustomAgentAction,
  resetToBlankAction,
} from "@/app/(app)/actions";

interface BlankStudioCanvasProps {
  config: Config;
  counts: Record<string, number>;
  /** Saved generations for the Dashboard and My Projects views. */
  projects: ProjectSummary[];
  canEditConfig: boolean;
  initialPrompt?: string;
  onAskAgent: (prompt: string) => void;
  onOpenBrandModal?: () => void;
  onOpenThemeModal?: () => void;
  onSwitchToBackend?: () => void;
  onApplied: (newConfig?: Config, firstViewId?: string | null, promptText?: string) => void;
  onPromptSent?: (prompt: string) => void;
  /** Device preview from the top bar. Phone/tablet collapse the chrome. */
  viewport: ViewportMode;
  /** Collapsible agent panel — closed, the canvas goes full width. */
  agentOpen: boolean;
  onToggleAgent: () => void;
}

interface StepItem {
  text: string;
  status: "pending" | "active" | "done";
}

// Audio waveform icon for input controls
function AudioWaveformIcon({ className = "h-4 w-4 text-zinc-400" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M3 8a1 1 0 011 1v2a1 1 0 11-2 0V9a1 1 0 011-1zm3-3a1 1 0 011 1v8a1 1 0 11-2 0V6a1 1 0 011-1zm4-3a1 1 0 011 1v14a1 1 0 11-2 0V3a1 1 0 011-1zm4 3a1 1 0 011 1v8a1 1 0 11-2 0V6a1 1 0 011-1zm3 3a1 1 0 011 1v2a1 1 0 11-2 0V9a1 1 0 011-1z" />
    </svg>
  );
}

/**
 * The shared center composer — the AI Agent footer and the dashboard
 * chatbox are the same box, not two designs.
 */
function CenterComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  autoFocus,
  onTemplateSelect,
  onAnalyzeSelect,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  disabled: boolean;
  placeholder: string;
  autoFocus?: boolean;
  onTemplateSelect: (pillPrompt: string) => void;
  onAnalyzeSelect: () => void;
}) {
  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSubmit(text);
  };

  return (
    <BorderBeam
      size="pulse-inner"
      colorVariant="colorful"
      strength={0.9}
      borderRadius={16}
      className="w-full shadow-2xl"
    >
      <div className="rounded-2xl border border-zinc-800/90 bg-[#121215] p-4">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          rows={2}
          disabled={disabled}
          className="no-scrollbar w-full bg-transparent text-sm sm:text-base text-zinc-100 placeholder:text-zinc-500 outline-none resize-none leading-relaxed font-sans"
          autoFocus={autoFocus}
        />

        {/* Bottom Action Strip */}
        <div className="flex items-center justify-between pt-3 border-t border-zinc-800/60">
          {/* Left: Templates Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                onTemplateSelect(
                  "Create a modern B2B CRM with Deals pipeline, Contacts table, and automated lead score",
                )
              }
              className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-[#18181c] px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-700 hover:text-white transition-colors"
            >
              <Plus size={13} />
              <span>Templates</span>
            </button>
          </div>

          {/* Right: Waveform & Solid Send Button (↑) */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAnalyzeSelect}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-[#18181c] text-zinc-400 hover:border-zinc-700 hover:text-white transition-colors"
              title="Audio input"
            >
              <AudioWaveformIcon className="h-4 w-4 text-zinc-400" />
            </button>

            <button
              type="button"
              onClick={submit}
              disabled={!value.trim() || disabled}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-black transition-all hover:bg-zinc-200 disabled:opacity-30 disabled:pointer-events-none shadow-md active:scale-95"
              title="Send to AI Agent"
            >
              {disabled ? (
                <ThinkingOrb state="working" size={20} theme="light" aria-hidden="true" />
              ) : (
                <ArrowUp size={16} strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
      </div>
    </BorderBeam>
  );
}

// Melting-pair artwork. The repo ships no image assets, so the two pieces
// are gradient tiles encoded as data URIs — the melt layer reads its source
// from the first <img> in each item, and data URIs keep it fully offline.
// Stops are the border-beam "colorful" pulse palette verbatim (rose, orange,
// green, cyan, teal / blue, indigo, purple, magenta, rose) so the pair melts
// in exactly the chatbox beam's colours.
const GOO_SVG_A = `<svg xmlns='http://www.w3.org/2000/svg' width='84' height='84' viewBox='0 0 84 84'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#FF3264'/><stop offset='0.3' stop-color='#FFA01E'/><stop offset='0.55' stop-color='#32C850'/><stop offset='0.8' stop-color='#28B4DC'/><stop offset='1' stop-color='#1EB9AA'/></linearGradient></defs><rect width='84' height='84' rx='16' fill='url(#g)'/></svg>`;
const GOO_SVG_B = `<svg xmlns='http://www.w3.org/2000/svg' width='84' height='84' viewBox='0 0 84 84'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#288CFF'/><stop offset='0.3' stop-color='#6446FF'/><stop offset='0.55' stop-color='#B428F0'/><stop offset='0.8' stop-color='#F032B4'/><stop offset='1' stop-color='#FF3264'/></linearGradient></defs><rect width='84' height='84' rx='16' fill='url(#g)'/></svg>`;
const GOO_ART_A = `data:image/svg+xml,${encodeURIComponent(GOO_SVG_A)}`;
const GOO_ART_B = `data:image/svg+xml,${encodeURIComponent(GOO_SVG_B)}`;

export function BlankStudioCanvas({
  config,
  counts,
  projects,
  canEditConfig,
  initialPrompt,
  onAskAgent,
  onOpenBrandModal,
  onOpenThemeModal,
  onSwitchToBackend,
  onApplied,
  onPromptSent,
  viewport,
  agentOpen,
  onToggleAgent,
}: BlankStudioCanvasProps) {
  const [prompt, setPrompt] = React.useState("");
  const [activeMain, setActiveMain] = React.useState("Dashboard");
  const stepsRef = React.useRef<HTMLDivElement>(null);

  // Center Thinking & Generation States
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [isCompleted, setIsCompleted] = React.useState(false);
  const [submittedPrompt, setSubmittedPrompt] = React.useState("");
  const [thinkingSeconds, setThinkingSeconds] = React.useState(0);
  const [assistantText, setAssistantText] = React.useState("");
  const [appliedResult, setAppliedResult] = React.useState<{
    config?: Config;
    firstViewId?: string | null;
    firstScreenId?: string | null;
    summary?: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = React.useState<{ patches: ConfigPatch[]; impact: ImpactSummary; prompt: string } | null>(null);
  const [applyingChanges, setApplyingChanges] = React.useState(false);
  const applyingRef = React.useRef(false);
  const generationAbort = React.useRef<AbortController | null>(null);
  const conversation = React.useRef<{ role: "user" | "assistant"; text: string }[]>([]);
  React.useEffect(() => () => generationAbort.current?.abort(), []);
  const [steps, setSteps] = React.useState<StepItem[]>([]);

  // The generated CRM, rendered inline in this center canvas — never a new page.
  const [liveCrm, setLiveCrm] = React.useState<BuilderCrmState | null>(null);
  const [liveLoading, setLiveLoading] = React.useState(false);

  const loadLiveCrm = React.useCallback(async (selection?: { screenId?: string; viewId?: string }) => {
    setLiveLoading(true);
    try {
      const state = await getBuilderCrmAction(selection);
      setLiveCrm(state);
    } catch (loadErr) {
      setError(
        loadErr instanceof Error
          ? `${loadErr.message} Describe the change again below.`
          : "That CRM could not be loaded. Describe the change again below.",
      );
    } finally {
      setLiveLoading(false);
    }
  }, []);

  // A patch confirmed in the right-side panel also lands here, not on a new page.
  const handleExternalApplied = React.useCallback(
    (newConfig?: Config, _firstViewId?: string | null, promptText?: string) => {
      onApplied(newConfig, null, promptText);
      setLiveDismissed(false);
      void loadLiveCrm();
    },
    [onApplied, loadLiveCrm],
  );

  // Returning to a workspace that already has a CRM shows it inline immediately.
  const bootstrapped = React.useRef(false);
  // One project snapshot per generation, even when a turn applies twice.
  const projectSavedRef = React.useRef(false);
  React.useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    if ((config.screens?.length ?? 0) + (config.views?.length ?? 0) > 0) {
      setIsCompleted(true);
      void loadLiveCrm();
    }
  }, [config.screens?.length, config.views?.length, loadLiveCrm]);

  // A reset to blank clears the inline preview back to the hero.
  const contentCount = (config.screens?.length ?? 0) + (config.views?.length ?? 0);
  React.useEffect(() => {
    if (contentCount === 0) {
      setLiveCrm(null);
      setIsCompleted(false);
      setAppliedResult(null);
    }
  }, [contentCount]);

  // Thinking timer
  React.useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isGenerating) {
      setThinkingSeconds(0);
      timer = setInterval(() => {
        setThinkingSeconds((s) => s + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isGenerating]);

  // Single live status line: the newest narrative fragment, folded into the
  // plan card so the layout never grows while thinking.
  const latestLine = React.useMemo(() => {
    const lines = assistantText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.length > 0 ? lines[lines.length - 1] : "";
  }, [assistantText]);

  // The plan list is capped at a fixed height: keep the active step in view
  // with an instant jump — the card and everything below it stay still.
  React.useEffect(() => {
    const el = stepsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps]);

  const mainNav = [
    { label: "Dashboard", icon: Home },
    { label: "AI Agent", icon: Bot },
    { label: "My Projects", icon: FolderKanban },
    { label: "Custom Agents", icon: Sparkles },
    { label: "Blueprints", icon: Workflow },
  ];

  // Minimal Google AI Studio / ChatGPT Starter Pills
  const starterPills = [
    {
      label: "Clinic & Healthcare",
      icon: Stethoscope,
      prompt: "Build a clinic CRM with patient intake, doctor appointment calendar, and triage agent",
    },
    {
      label: "Commercial Real Estate",
      icon: Building2,
      prompt: "Create a real estate CRM with property listings, lease contracts, and escrow stages",
    },
    {
      label: "B2B SaaS Sales Engine",
      icon: Laptop,
      prompt: "Build a B2B SaaS CRM with ARR metrics, enterprise deal stages, and lead qualification agent",
    },
    {
      label: "Creative Agency Sprints",
      icon: Palette,
      prompt: "Make a creative agency CRM with client retainers, deliverables, and sprint Kanban boards",
    },
  ];

  const applyGeneratedChanges = async (change: { patches: ConfigPatch[]; impact: ImpactSummary; prompt: string }) => {
    if (!canEditConfig || applyingRef.current) return;
    applyingRef.current = true;
    setApplyingChanges(true);
    setError(null);
    try {
      const response = await fetch("/api/agent/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patches: change.patches }) });
      if (!response.ok) throw new Error((await response.text()) || "Those changes could not be applied.");
      const result = await response.json();
      setPendingChanges(null);
      setSteps((previous) => previous.map((step) => ({ ...step, status: "done" })));
      setAppliedResult(result);
      setIsCompleted(true);
      onApplied(result.config, null, change.prompt);
      if (result.config && !projectSavedRef.current) {
        const projectName = result.config.brand?.name || change.prompt.slice(0, 60);
        const saved = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: projectName, prompt: change.prompt, config: result.config }) }).catch(() => null);
        projectSavedRef.current = Boolean(saved?.ok);
        if (!saved?.ok) setError("Your CRM was saved, but its project snapshot could not be created. You can continue using your workspace.");
      }
      await loadLiveCrm();
    } catch (caught) {
      setPendingChanges(change);
      setError(caught instanceof Error ? caught.message : "Those changes could not be applied. Try again.");
    } finally { applyingRef.current = false; setApplyingChanges(false); }
  };

  const handleSendPrompt = async (textToSend?: string) => {
    const text = (textToSend ?? prompt).trim();
    if (!text || generationAbort.current || applyingRef.current) return;
    if (!canEditConfig) { setError("Your role cannot change this workspace. Ask an owner or admin."); return; }
    const abort = new AbortController();
    generationAbort.current = abort;
    setPrompt(""); setSubmittedPrompt(text); setIsGenerating(true); setIsCompleted(false);
    setPendingChanges(null); projectSavedRef.current = false; setLiveDismissed(false);
    setAssistantText(""); setError(null); onPromptSent?.(text);
    setSteps([{ text: "Reading your request", status: "active" }]);
    let reply = "";
    try {
      const response = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: text, history: conversation.current.slice(-20) }), signal: abort.signal });
      if (!response.ok || !response.body) throw new Error((await response.text()) || "The agent could not be reached.");
      type Event = { type: string; steps?: string[]; delta?: string; patches?: ConfigPatch[]; impact?: ImpactSummary; message?: string; questions?: string[] };
      for await (const event of readJsonLines<Event>(response.body)) {
        if (abort.signal.aborted) break;
        if (event.type === "thinking" && Array.isArray(event.steps)) setSteps(event.steps.map((text, index) => ({ text, status: index === event.steps!.length - 1 ? "active" : "done" })));
        else if (event.type === "text" && event.delta) { reply += event.delta; setAssistantText(reply); }
        else if (event.type === "patch" && event.patches) {
          if (!event.impact) throw new Error("The change could not be reviewed. Ask the agent to try again.");
          const change = { patches: event.patches, impact: event.impact, prompt: text };
          if (needsConfirmation(event.impact)) setPendingChanges(change);
          else await applyGeneratedChanges(change);
        } else if (event.type === "error") throw new Error(event.message || "The agent could not finish that change.");
        else if (event.type === "questions" && event.questions) {
          reply += "\n\n" + event.questions.map((question, index) => `${index + 1}. ${question}`).join("\n");
          setAssistantText(reply.trim());
        }
        else if (event.type === "connect_required") setError("Connect the requested account in the agent panel, then try again.");
      }
    } catch (caught) {
      setError(abort.signal.aborted ? "Generation stopped. Applied changes are still available in your workspace." : caught instanceof Error ? caught.message : "The agent could not finish. Try again.");
    } finally {
      conversation.current = [...conversation.current, { role: "user" as const, text: text.slice(0, 8000) }, ...(reply ? [{ role: "assistant" as const, text: reply.slice(0, 8000) }] : [])].slice(-20);
      setIsGenerating(false); generationAbort.current = null;
    }
  };

  const handleSelectPill = (pillPrompt: string) => {
    setPrompt(pillPrompt);
    handleSendPrompt(pillPrompt);
  };

  // Dismissing the live canvas returns to the chatbox screen; the next
  // build or applied patch brings it back.
  const [liveDismissed, setLiveDismissed] = React.useState(false);
  const showLiveCrm =
    !isGenerating && !liveDismissed && liveCrm !== null && liveCrm.activeKind !== null;

  // Dashboard chatbox, agents form, project restore — the nav pages' state.
  const [dashInput, setDashInput] = React.useState("");
  const [agentForm, setAgentForm] = React.useState({ name: "", role: "", instructions: "" });
  const [agentBusy, setAgentBusy] = React.useState(false);
  const [agentError, setAgentError] = React.useState<string | null>(null);
  const [opening, setOpening] = React.useState<string | null>(null);
  const [projectError, setProjectError] = React.useState<string | null>(null);
  const [resetting, setResetting] = React.useState(false);

  const addAgent = async (event: React.FormEvent) => {
    event.preventDefault();
    if (agentBusy || !canEditConfig) return;
    const name = agentForm.name.trim();
    const role = agentForm.role.trim();
    const instructions = agentForm.instructions.trim();
    if (!name || !role || !instructions) {
      setAgentError("Name, role and instructions are all required.");
      return;
    }
    setAgentBusy(true);
    setAgentError(null);
    try {
      const result = await addCustomAgentAction({
        name,
        role,
        description: `${role} for ${config.brand?.name ?? "the workspace"}`,
        instructions,
      });
      if (!result.success) {
        setAgentError(result.error ?? "That agent could not be added.");
        return;
      }
      setAgentForm({ name: "", role: "", instructions: "" });
      onApplied();
    } finally {
      setAgentBusy(false);
    }
  };

  const removeAgent = async (id: string) => {
    if (agentBusy || !canEditConfig) return;
    setAgentBusy(true);
    setAgentError(null);
    try {
      const result = await removeCustomAgentAction(id);
      if (!result.success) setAgentError(result.error ?? "That agent could not be removed.");
      else onApplied();
    } finally {
      setAgentBusy(false);
    }
  };

  /**
   * Starts over.
   *
   * Without this there was no way to begin a second CRM: asking for one simply
   * built it on top of the first, so a sales workspace ended up wearing the
   * previous restaurant's screens. Whatever is here is already saved as a
   * project and is one rollback away regardless, so this clears rather than
   * asks twice.
   */
  const startNewProject = async () => {
    if (resetting) return;
    setResetting(true);
    setProjectError(null);
    try {
      const result = await resetToBlankAction();
      if (!result.success) {
        setProjectError(result.error ?? "A new project could not be started.");
        return;
      }
      setActiveMain("AI Agent");
      setLiveDismissed(false);
      onApplied();
      await loadLiveCrm();
    } finally {
      setResetting(false);
    }
  };

  /** Opens a saved project: its snapshot becomes the workspace (a new
      version, so the current one survives in history) and the canvas shows it. */
  const openProject = async (id: string) => {
    if (opening !== null) return;
    setOpening(id);
    setProjectError(null);
    try {
      const result = await openProjectAction(id);
      if (!result.success) {
        setProjectError(result.error ?? "That project could not be opened.");
        return;
      }
      setActiveMain("AI Agent");
      setLiveDismissed(false);
      onApplied();
      await loadLiveCrm();
    } finally {
      setOpening(null);
    }
  };

  // Phone/tablet preview: chrome collapses to an icon rail, the agent panel floats.
  const constrained = viewport !== "desktop";

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-[#09090b] text-zinc-100 select-none">
      
      {/* ========================================================
          COLUMN 1: LEFT SIDEBAR (~240px, NO PIPELINES)
         ======================================================== */}
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-zinc-800/80 bg-[#0c0c0e]",
          constrained ? "w-14 items-center p-2 pt-3" : "w-60 p-3.5 pt-4",
        )}
      >
        {/* Navigation */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
          <div>
            {!constrained && (
              <p className="px-2 mb-2 text-[10px] font-mono font-medium uppercase tracking-wider text-zinc-500">
                Navigation
              </p>
            )}
            <nav className="space-y-0.5">
              {mainNav.map((item) => {
                const Icon = item.icon;
                const isActive = activeMain === item.label;
                return (
                  <button
                    key={item.label}
                    type="button"
                    title={item.label}
                    onClick={() => {
                      setActiveMain(item.label);
                      if (item.label === "Blueprints" && onSwitchToBackend) onSwitchToBackend();
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors text-left",
                      constrained && "justify-center px-0",
                      isActive
                        ? "bg-zinc-800/90 text-white shadow-sm font-semibold"
                        : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
                    )}
                  >
                    <Icon size={15} className={isActive ? "text-white" : "text-zinc-400"} />
                    {!constrained && <span>{item.label}</span>}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </aside>

      {/* ========================================================
          COLUMN 2: CENTER CANVAS (Google AI Studio & ChatGPT UI)
         ======================================================== */}
      <main className="flex flex-1 flex-col overflow-hidden bg-[#09090b]">
        <div
          className={cn(
            "no-scrollbar mx-auto flex min-h-0 w-full flex-1 flex-col items-center px-6 py-8 text-center",
            showLiveCrm && activeMain === "AI Agent" ? "max-w-6xl overflow-hidden" : "max-w-3xl overflow-y-auto",
          )}
        >

          {pendingChanges && <div className="mb-4 w-full max-w-xl text-left">
            <ConfigDiff patches={pendingChanges.patches} impact={pendingChanges.impact} status={applyingChanges ? "applying" : "ready"} onConfirm={() => void applyGeneratedChanges(pendingChanges)} onDiscard={() => { setPendingChanges(null); setError(null); }} />
          </div>}
          {isGenerating && <button type="button" onClick={() => generationAbort.current?.abort()} className="mb-3 rounded border border-edge px-3 py-2 text-xs text-content-secondary hover:text-content">Stop generation</button>}
          {activeMain === "Dashboard" ? (
            /* ====================================================
               DASHBOARD: workspace overview, chatbox hands off to AI Agent
               ==================================================== */
            <div className="studio-view-enter m-auto flex w-full max-w-2xl flex-col items-center justify-center space-y-7 py-6 text-center">
              <div className="space-y-2.5 max-w-xl">
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
                  {config.brand?.name ?? "Workspace"} overview
                </h1>
                <p className="text-sm sm:text-base text-zinc-400 leading-relaxed">
                  {config.brand?.tagline ?? "Everything the agent has built, at a glance."}
                </p>
              </div>

              <div className="grid w-full grid-cols-2 sm:grid-cols-4 gap-2 text-left">
                {[
                  {
                    label: "Records",
                    value: Object.values(counts)
                      .reduce((sum, n) => sum + n, 0)
                      .toLocaleString(),
                  },
                  { label: "Objects", value: String(config.objects.length) },
                  {
                    label: "Views & screens",
                    value: String(config.views.length + config.screens.length),
                  },
                  { label: "Custom agents", value: String(config.customAgents?.length ?? 0) },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-xl border border-zinc-800/90 bg-[#131316] p-3.5 shadow-sm"
                  >
                    <p className="text-xl font-semibold tracking-tight text-white">{stat.value}</p>
                    <p className="mt-0.5 text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>

              <div className="w-full">
                <CenterComposer
                  value={dashInput}
                  onChange={setDashInput}
                  onSubmit={(text) => {
                    setDashInput("");
                    setActiveMain("AI Agent");
                    void handleSendPrompt(text);
                  }}
                  disabled={isGenerating || applyingChanges || !canEditConfig}
                  placeholder="Describe the CRM to build or refine..."
                  autoFocus
                  onTemplateSelect={(pill) => {
                    setDashInput("");
                    setActiveMain("AI Agent");
                    void handleSendPrompt(pill);
                  }}
                  onAnalyzeSelect={() => {
                    setDashInput("");
                    setActiveMain("AI Agent");
                    void handleSendPrompt("Analyze my current CRM schema and suggest custom agents");
                  }}
                />
              </div>

              {projects.length > 0 && (
                <div className="w-full space-y-2 text-left">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 px-0.5">
                    Recent generations
                  </p>
                  {projects.slice(0, 3).map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => setActiveMain("My Projects")}
                      className="w-full rounded-xl border border-zinc-800/90 bg-[#131316] px-3.5 py-2.5 text-left transition-all hover:border-zinc-700 hover:bg-zinc-900/80 group"
                    >
                      <p className="text-xs font-medium text-zinc-200 group-hover:text-white truncate">
                        {project.name}
                      </p>
                      <p className="mt-0.5 text-[10px] font-mono text-zinc-500">
                        {new Date(project.createdAt).toLocaleDateString()}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : activeMain === "My Projects" ? (
            /* ====================================================
               MY PROJECTS: every finished generation, saved whole —
               open one to work in it again.
               ==================================================== */
            <div className="studio-view-enter w-full max-w-2xl space-y-4 py-6 text-left">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold tracking-tight text-white">My Projects</h1>
                  <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
                    Every finished generation, saved whole. Opening one makes it the workspace
                    again — as a new version, so whatever is current survives in history.
                  </p>
                </div>
                {canEditConfig && (
                  <button
                    type="button"
                    onClick={() => void startNewProject()}
                    disabled={resetting}
                    className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:opacity-40"
                  >
                    <Plus size={14} aria-hidden="true" />
                    {resetting ? "Starting…" : "New project"}
                  </button>
                )}
              </div>

              {projectError && (
                <p role="alert" className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 p-2.5 rounded-xl">
                  {projectError}
                </p>
              )}

              {projects.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center">
                  <p className="text-sm text-zinc-300">No projects yet.</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Describe a CRM on the dashboard and it appears here as a project.
                  </p>
                </div>
              ) : (
                <ol className="space-y-2">
                  {projects.map((project) => (
                    <li
                      key={project.id}
                      className="rounded-xl border border-zinc-800/90 bg-[#131316] p-3.5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-100">{project.name}</p>
                          <p className="mt-0.5 text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                            {project.prompt}
                          </p>
                          <p className="mt-1 text-[11px] font-mono text-zinc-500">
                            {new Date(project.createdAt).toLocaleString()}
                          </p>
                        </div>
                        {canEditConfig && (
                          <button
                            type="button"
                            onClick={() => void openProject(project.id)}
                            disabled={opening !== null}
                            className="shrink-0 rounded-lg border border-zinc-800 bg-[#18181c] px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-600 hover:text-white transition-colors disabled:opacity-40"
                          >
                            {opening === project.id ? "Opening…" : "Open"}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : activeMain === "Custom Agents" ? (
            /* ====================================================
               CUSTOM AGENTS: assistants embedded in the generated CRM —
               a different job from the builder agent that made it.
               ==================================================== */
            <div className="studio-view-enter w-full max-w-2xl space-y-4 py-6 text-left">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Agent instructions</h1>
                <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
                  Save the roles and instructions you want future assistants to follow.
                  These are configuration drafts; autonomous execution is not available yet.
                </p>
              </div>

              {agentError && (
                <p role="alert" className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 p-2.5 rounded-xl">
                  {agentError}
                </p>
              )}

              {canEditConfig && (
                <form
                  onSubmit={(e) => void addAgent(e)}
                  className="rounded-xl border border-zinc-800/90 bg-[#131316] p-4 space-y-2.5 shadow-sm"
                >
                  <div className="grid sm:grid-cols-2 gap-2.5">
                    <input
                      aria-label="Agent name"
                      value={agentForm.name}
                      onChange={(e) => setAgentForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Agent name, e.g. Inbound Qualifier"
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-500"
                    />
                    <input
                      aria-label="Agent role"
                      value={agentForm.role}
                      onChange={(e) => setAgentForm((f) => ({ ...f, role: e.target.value }))}
                      placeholder="Role, e.g. Lead qualification"
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-500"
                    />
                  </div>
                  <textarea
                    aria-label="Agent instructions"
                    value={agentForm.instructions}
                    onChange={(e) => setAgentForm((f) => ({ ...f, instructions: e.target.value }))}
                    placeholder="Describe this agent's intended role and rules."
                    rows={3}
                    className="no-scrollbar w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-500 resize-none"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={
                        agentBusy ||
                        !agentForm.name.trim() ||
                        !agentForm.role.trim() ||
                        !agentForm.instructions.trim()
                      }
                      className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black transition-all hover:bg-zinc-200 disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <Plus size={13} />
                      <span>{agentBusy ? "Saving…" : "Save instructions"}</span>
                    </button>
                  </div>
                </form>
              )}

              {(config.customAgents ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-zinc-400">
                    <Bot size={20} />
                  </div>
                  <p className="mt-3 text-sm text-zinc-300">No custom agents yet.</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Save instructions above, or ask the builder agent to draft them with you.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {(config.customAgents ?? []).map((agent) => (
                    <li
                      key={agent.id}
                      className="flex items-start justify-between gap-3 rounded-xl border border-zinc-800/90 bg-[#131316] p-3.5 shadow-sm"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-zinc-400">
                          <Bot size={15} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-100">{agent.name}</p>
                          <p className="text-xs text-zinc-400">{agent.role}</p>
                          {agent.description && (
                            <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{agent.description}</p>
                          )}
                        </div>
                      </div>
                      {canEditConfig && (
                        <button
                          type="button"
                          onClick={() => void removeAgent(agent.id)}
                          disabled={agentBusy}
                          className="shrink-0 rounded-lg px-2 py-1 text-xs text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-40"
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
          {/* ====================================================
              VIEW A: THINKING / GENERATION PROCESS IN CENTER
              ==================================================== */}
          {isGenerating ? (
            <div className="studio-view-enter m-auto flex w-full flex-col items-center justify-center space-y-6 py-6 text-center">
              {/* Melting pair — the headline while generating. One piece stays
                  centred, the other floats an ellipse around it; the melt
                  follows their rects so they run molten together and apart. */}
              <div className="flex flex-col items-center">
                <p className="sr-only" role="status">
                  AI Agent is building your CRM. Reasoning through database requirements, PostgreSQL schema, deal
                  stages, and custom views.
                </p>
                <Liquid aria-hidden="true" blur={8} className="relative h-[220px] w-[300px] animate-goo-hue">
                  <Liquid.Item effect="melt" melt={{ blur: 8, contrast: 24, fade: 20, mix: 1 }}>
                    <img
                      src={GOO_ART_A}
                      alt=""
                      draggable={false}
                      style={{ width: 84, height: 84, borderRadius: 16 }}
                      className="absolute left-1/2 top-1/2 -ml-[42px] -mt-[42px]"
                    />
                  </Liquid.Item>
                  <Liquid.Item effect="melt" melt={{ blur: 8, contrast: 24, fade: 20, mix: 1 }}>
                    <img
                      src={GOO_ART_B}
                      alt=""
                      draggable={false}
                      style={{ width: 84, height: 84, borderRadius: 16 }}
                      className="absolute left-1/2 top-1/2 -ml-[42px] -mt-[42px] animate-goo-orbit"
                    />
                  </Liquid.Item>
                </Liquid>
              </div>

              {/* Live Step Progression Card */}
              <div className="w-full max-w-lg rounded-2xl border border-zinc-800/90 bg-[#121215] p-5 text-left space-y-3.5 shadow-xl">
                <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 pb-2.5 border-b border-zinc-800/60">
                  <ListChecks size={14} className="text-purple-400" />
                  <span className="font-semibold text-zinc-200">Plan</span>
                </div>

                <div
                  ref={stepsRef}
                  className="no-scrollbar max-h-[204px] overflow-y-auto pr-1 space-y-2.5 text-xs"
                >
                  {steps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2.5">
                      {step.status === "done" ? (
                        <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                      ) : step.status === "active" ? (
                        <ThinkingOrb state="working" size={20} theme="dark" className="shrink-0" />
                      ) : (
                        <div className="h-3.5 w-3.5 rounded-full border border-zinc-700 shrink-0" />
                      )}
                      <span
                        className={cn(
                          step.status === "done" && "text-zinc-400",
                          step.status === "active" && "text-white font-medium",
                          step.status === "pending" && "text-zinc-600"
                        )}
                      >
                        {step.text}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Live status: one line, fixed height — the narrative folds in
                    here instead of growing a preview box below. */}
                <div className="pt-2.5 mt-1 border-t border-zinc-800/60">
                  <p className="h-4 truncate font-mono text-[11px] leading-4 text-zinc-500">
                    {latestLine || " "}
                  </p>
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 p-2.5 rounded-xl max-w-lg">
                  {error}
                </p>
              )}
            </div>
          ) : showLiveCrm && liveCrm && liveCrm.activeKind !== null ? (
            /* ====================================================
                VIEW B: LIVE CRM INLINE — the generated workspace,
                rendered here in the center. No new page.
               ==================================================== */
            <div className="studio-view-enter flex min-h-0 w-full flex-1 flex-col gap-2 py-2 text-left">
              <div className="flex items-center justify-between gap-3 px-1">
                <p className="min-w-0 truncate text-xs text-zinc-400">
                  {appliedResult?.summary ?? submittedPrompt ?? "Live preview"}
                  <span className="text-zinc-600"> — refine it below</span>
                </p>
                <button
                  type="button"
                  onClick={() => setLiveDismissed(true)}
                  title="Back to the chatbox"
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-[#18181c] px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-700 hover:text-white transition-colors"
                >
                  <ChevronLeft size={12} />
                  <span>Back</span>
                </button>
              </div>

              <div className="min-h-0 w-full flex-1 overflow-hidden rounded-2xl border border-zinc-800/90 shadow-xl">
                <DynamicCrmCanvas
                  config={liveCrm.config}
                  activeScreenId={liveCrm.screen?.id}
                  activeViewId={liveCrm.resolvedView?.view.id}
                  onSelectScreen={(screenId) => void loadLiveCrm({ screenId })}
                  onSelectView={(viewId) => void loadLiveCrm({ viewId })}
                >
                  {liveCrm.activeKind === "screen" && liveCrm.screen && liveCrm.screenData ? (
                    <ScreenSurface
                      key={liveCrm.screen.id}
                      screen={liveCrm.screen}
                      config={liveCrm.config}
                      data={liveCrm.screenData}
                      onAskAgent={(agentPrompt) => setPrompt(agentPrompt)}
                    />
                  ) : liveCrm.activeKind === "view" &&
                    liveCrm.resolvedView &&
                    liveCrm.records ? (
                    <ViewScreen
                      key={liveCrm.resolvedView.view.id}
                      resolved={liveCrm.resolvedView}
                      config={liveCrm.config}
                      initialRecords={liveCrm.records}
                      initialTotal={liveCrm.total ?? liveCrm.records.length}
                      initialTitles={liveCrm.titles ?? {}}
                      columnWidths={liveCrm.columnWidths ?? {}}
                    />
                  ) : null}
                </DynamicCrmCanvas>
              </div>

              {liveLoading && (
                <p className="px-1 text-xs text-zinc-500">Loading records…</p>
              )}
              {liveCrm.error && (
                <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 p-2.5 rounded-xl">
                  {liveCrm.error} Describe what you need again below.
                </p>
              )}
              {error && (
                <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 p-2.5 rounded-xl">
                  {error}
                </p>
              )}
            </div>
          ) : isCompleted ? (
            /* ====================================================
                VIEW C: APPLIED BUT NOTHING TO SHOW YET
               ==================================================== */
            <div className="studio-view-enter m-auto flex w-full flex-col items-center justify-center space-y-6 py-6 text-center">
              <div className="space-y-2 max-w-md">
                <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                  Change applied
                </h2>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  {appliedResult?.summary ??
                    "There is no table or board to show yet. Describe the first one below and it appears here."}
                </p>
              </div>

              {liveCrm?.error && (
                <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 p-2.5 rounded-xl max-w-lg">
                  {liveCrm.error} Describe what you need again below.
                </p>
              )}
              {error && (
                <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 p-2.5 rounded-xl max-w-lg">
                  {error}
                </p>
              )}
            </div>
          ) : (
            /* ====================================================
                VIEW D: INITIAL HERO (WHAT WOULD YOU LIKE TO BUILD?)
               ==================================================== */
            <div className="m-auto flex w-full flex-col items-center justify-center text-center space-y-7 py-6">
              {/* Heading & Subtitle */}
              <div className="space-y-2.5 max-w-xl">
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
                  What would you like to build today?
                </h1>
                <p className="text-sm sm:text-base text-zinc-400 leading-relaxed">
                  Describe your schema, custom workflows, or data models. The AI Agent will generate your live database, views, and custom agents.
                </p>
              </div>

              {/* Minimal Prompt Starter Pills (Google AI Studio & ChatGPT Style) */}
              <div className="flex flex-wrap items-center justify-center gap-2 max-w-2xl pt-1">
                {starterPills.map((pill) => {
                  const Icon = pill.icon;
                  return (
                    <button
                      key={pill.label}
                      type="button"
                      onClick={() => handleSelectPill(pill.prompt)}
                      className="flex items-center gap-2 rounded-xl border border-zinc-800/90 bg-[#131316] px-3.5 py-2 text-xs text-zinc-300 hover:border-zinc-700 hover:text-white hover:bg-zinc-900/80 transition-all shadow-sm group"
                    >
                      <Icon size={14} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />
                      <span>{pill.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          </>
          )}

        </div>

        {/* Pinned composer — fixed at the column bottom outside the scroll
            area, so planning never pushes it down. Only the AI Agent view
            composes here; hidden once the live CRM takes the canvas. */}
        {activeMain === "AI Agent" && !showLiveCrm && (
          <div className="shrink-0 px-6 pb-6">
            <div className="mx-auto w-full max-w-3xl">
              <CenterComposer
                value={prompt}
                onChange={setPrompt}
                onSubmit={(text) => void handleSendPrompt(text)}
                disabled={isGenerating || applyingChanges || !canEditConfig}
                placeholder={
                  isGenerating
                    ? "AI Agent is synthesizing... (you can queue follow-up refinements)..."
                    : isCompleted
                      ? "Refine this CRM or add more features (e.g. Add doctor appointment board)..."
                      : "Ask Gemini anything or describe your CRM (e.g. Build a healthcare clinic CRM with patient intake)..."
                }
                autoFocus
                onTemplateSelect={(pill) => void handleSelectPill(pill)}
                onAnalyzeSelect={() =>
                  handleSelectPill("Analyze my current CRM schema and suggest custom agents")
                }
              />
            </div>
          </div>
        )}
      </main>

      {/* ========================================================
          COLUMN 3: RIGHT SIDEBAR — collapsible so the canvas can go full
          width. In phone/tablet preview it floats over the canvas.
          (Initial prompt is NOT passed so its input is NOT polluted!)
          ======================================================== */}
      {agentOpen && (
        <button
          type="button"
          onClick={onToggleAgent}
          title="Hide AI agent panel"
          aria-label="Hide AI agent panel"
          className="flex w-6 shrink-0 items-center justify-center border-l border-zinc-800/80 bg-[#0c0c0e] text-zinc-500 transition-colors hover:text-white"
        >
          <PanelRightClose size={14} />
        </button>
      )}
      {agentOpen && (
        <AgentPanel
          config={config}
          counts={counts}
          canEditConfig={canEditConfig}
          hideHeader={true}
          className={constrained ? "absolute inset-y-0 right-0 z-30 shadow-2xl" : "w-80 md:w-96 lg:w-[420px] shrink-0"}
          onApplied={handleExternalApplied}
          onPromptSent={onPromptSent}
        />
      )}
      {!agentOpen && (
        <button
          type="button"
          onClick={onToggleAgent}
          title="Show AI agent panel"
          className="absolute bottom-6 right-6 z-30 flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-xs font-medium text-white shadow-2xl transition-all hover:bg-zinc-800"
        >
          <Bot size={14} />
          <span>AI Agent</span>
        </button>
      )}

    </div>
  );
}
