"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Bot, PanelRightClose } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import type { Config, ConfigPatch } from "@/lib/config/types";
import type { ProjectSummary } from "@/lib/projects";
import type { SessionUser } from "@/lib/auth/session";
import { CommandPalette, type PaletteResult } from "@/components/renderers/CommandPalette";
import { AgentPanel } from "@/components/agent/AgentPanel";
import {
  searchRecordsAction,
  updateBrandAction,
  updateThemeAction,
  resetToBlankAction,
  addCustomAgentAction,
  removeCustomAgentAction,
} from "./actions";
import { signOutAction } from "@/app/(auth)/actions";
import { cn } from "@/lib/utils";
import { BuilderTopBar } from "@/components/builder/BuilderTopBar";
import { FigmaCanvasFrame, type ViewportMode } from "@/components/builder/FigmaCanvasFrame";
const BrandCustomizerModal = dynamic(() => import("@/components/builder/BrandCustomizerModal").then((module) => module.BrandCustomizerModal));
const ThemeEditorModal = dynamic(() => import("@/components/builder/ThemeEditorModal").then((module) => module.ThemeEditorModal));
const CustomAgentsModal = dynamic(() => import("@/components/builder/CustomAgentsModal").then((module) => module.CustomAgentsModal));
import { BlankStudioCanvas } from "@/components/builder/BlankStudioCanvas";
import { DynamicCrmCanvas } from "@/components/canvas/DynamicCrmCanvas";
import { EditorShell } from "@/components/backend/EditorShell";

import { themeAttributes, themeVars } from "@/lib/config/theme";

/**
 * Studio chrome is product UI, not tenant output. A customer's generated theme
 * is re-applied only around the frontend preview below, so editing that theme
 * cannot recolour Backend, navigation, or the agent workspace.
 */
const STUDIO_THEME_ATTRIBUTES = themeAttributes();
const STUDIO_THEME_VARS = themeVars();

export function AppShell({
  session,
  config,
  counts,
  projects,
  children,
}: {
  session: SessionUser;
  config: Config;
  counts: Record<string, number>;
  projects: ProjectSummary[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isUtilityRoute = pathname.startsWith("/settings/") || pathname.startsWith("/records/");
  const isStudioHome = pathname === "/studio";

  // Studio tabs: the generated CRM and its saved backend configuration.
  const [activeTab, setActiveTab] = React.useState<"frontend" | "backend">("frontend");
  const [viewport, setViewport] = React.useState<ViewportMode>("desktop");
  const [zoom, setZoom] = React.useState<number>(1.0);

  const [brandModalOpen, setBrandModalOpen] = React.useState(false);
  const [themeModalOpen, setThemeModalOpen] = React.useState(false);
  const [agentsModalOpen, setAgentsModalOpen] = React.useState(false);

  const [agentOpen, setAgentOpen] = React.useState(false);
  // The blank studio keeps its own panel state (open by default) so
  // collapsing it there never disturbs the live-canvas default.
  const [studioPanelOpen, setStudioPanelOpen] = React.useState(true);
  const [agentPrompt, setAgentPrompt] = React.useState("");

  const openAgentWithPrompt = React.useCallback((prompt: string) => {
    setAgentPrompt(prompt);
    setAgentOpen(true);
  }, []);

  const [results, setResults] = React.useState<PaletteResult[]>([]);
  const [searching, setSearching] = React.useState(false);

  const [searchError, setSearchError] = React.useState<string>();
  const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGeneration = React.useRef(0);
  React.useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchGeneration.current++;
  }, []);
  const search = React.useCallback((query: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const generation = ++searchGeneration.current;
    setResults([]);
    setSearchError(undefined);
    if (query.trim().length < 2) { setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      void searchRecordsAction(query).then((found) => {
        if (generation === searchGeneration.current) setResults(found);
      }).catch(() => {
        if (generation === searchGeneration.current) setSearchError("Search could not load. Try again.");
      }).finally(() => {
        if (generation === searchGeneration.current) setSearching(false);
      });
    }, 250);
  }, []);

  const [currentConfig, setCurrentConfig] = React.useState(config);
  React.useEffect(() => {
    setCurrentConfig(config);
  }, [config]);

  const applyEditorPatches = React.useCallback(
    async (patches: ConfigPatch[]) => {
      try {
        const response = await fetch("/api/agent/apply", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The editor is a second author of the same patches. Saying so is
          // what lets change history tell a hand edit from a generated one.
          body: JSON.stringify({ patches, author: "user" }),
        });
        if (!response.ok) {
          return { success: false, error: await response.text() };
        }
        const result = (await response.json()) as { config: Config };
        setCurrentConfig(result.config);
        router.refresh();
        return { success: true, config: result.config };
      } catch {
        return { success: false, error: "The configuration service could not be reached. Try again." };
      }
    },
    [router],
  );

  const openSearch = () => {
    const event = new KeyboardEvent("keydown", { key: "k", metaKey: true });
    window.dispatchEvent(event);
  };

  return (
    <div
      {...STUDIO_THEME_ATTRIBUTES}
      style={STUDIO_THEME_VARS as React.CSSProperties}
      className="flex h-screen w-screen flex-col overflow-hidden bg-surface text-content font-sans"
    >
      {/* Top Claude Desktop-Style Navigation Bar */}
      <BuilderTopBar
        tenantName={session.tenantName}
        brand={currentConfig.brand}
        customAgentsCount={currentConfig.customAgents?.length ?? 0}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          if (isUtilityRoute) router.push("/studio");
        }}
        viewport={viewport}
        onViewportChange={setViewport}
        zoom={zoom}
        onZoomChange={setZoom}
        onResetToBlank={
          session.canEditConfig
            ? async () => {
                const result = await resetToBlankAction();
                if (result.success) {
                  setActiveTab("frontend");
                  router.push("/studio");
                  router.refresh();
                }
              }
            : undefined
        }
        onOpenBrandModal={session.canEditConfig ? () => setBrandModalOpen(true) : undefined}
        onOpenThemeModal={session.canEditConfig ? () => setThemeModalOpen(true) : undefined}
        onOpenAgentsModal={session.canEditConfig ? () => setAgentsModalOpen(true) : undefined}
        onSignOut={async () => {
          await signOutAction();
        }}
        agentOpen={activeTab === "backend" ? agentOpen : isStudioHome ? studioPanelOpen : agentOpen}
        onToggleAgent={() =>
          activeTab === "backend"
            ? setAgentOpen((open) => !open)
            : isStudioHome
              ? setStudioPanelOpen((open) => !open)
              : setAgentOpen((open) => !open)
        }
        onOpenSearch={openSearch}
      />

      {/* Main Studio Viewport — both panes stay mounted so a generation
          keeps running while the user checks the other tab. */}
      {isUtilityRoute && <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <nav aria-label="Workspace tools" className="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-edge bg-surface-sunken px-4 py-3 text-sm">
            <Link href="/studio" className="shrink-0 text-content-secondary hover:text-content">Back to studio</Link>
            {[["/settings/import", "Import data"], ["/settings/email", "Email"], ["/settings/history", "Change history"]].map(([href, label]) => <Link key={href} href={href!} aria-current={pathname === href ? "page" : undefined} className={cn("shrink-0 rounded px-3 py-2", pathname === href ? "bg-surface-hover text-content" : "text-content-secondary hover:text-content")}>{label}</Link>)}
          </nav>
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </div>
        {agentOpen && <AgentPanel config={currentConfig} counts={counts} canEditConfig={session.canEditConfig} initialPrompt={agentPrompt} onClose={() => setAgentOpen(false)} onApplied={(next) => { if (next) setCurrentConfig(next); router.refresh(); }} />}
      </div>}
      <div className={cn("relative flex flex-1 min-h-0 w-full overflow-hidden", isUtilityRoute && "hidden")}>
        {/* TAB 1: FRONTEND CRM CANVAS */}
        <div
          {...themeAttributes(currentConfig.theme)}
          style={themeVars(currentConfig.theme) as React.CSSProperties}
          className={cn("h-full min-h-0 min-w-0 flex-1 font-sans", activeTab !== "frontend" && "hidden")}
        >
          <FigmaCanvasFrame viewport={viewport} zoom={zoom}>
            {isStudioHome ? (
              <BlankStudioCanvas
                config={currentConfig}
                counts={counts}
                projects={projects}
                canEditConfig={session.canEditConfig}
                initialPrompt={agentPrompt}
                viewport={viewport}
                agentOpen={studioPanelOpen}
                onToggleAgent={() => setStudioPanelOpen((open) => !open)}
                onAskAgent={(prompt) => {
                  setAgentPrompt(prompt);
                }}
                onOpenBrandModal={session.canEditConfig ? () => setBrandModalOpen(true) : undefined}
                onOpenThemeModal={session.canEditConfig ? () => setThemeModalOpen(true) : undefined}
                onSwitchToBackend={() => setActiveTab("backend")}
                onApplied={(newConfig) => {
                  // The builder renders the generated CRM inline in its
                  // center canvas — no route change, no new page. Refresh
                  // revalidates the shell (brand, counts) only.
                  if (newConfig) {
                    setCurrentConfig(newConfig);
                  }
                  router.refresh();
                }}
                onPromptSent={(prompt) => {
                  setAgentPrompt(prompt);
                }}
              />
            ) : (
              <DynamicCrmCanvas
                config={currentConfig}
                onAskAgent={(prompt) => {
                  setAgentPrompt(prompt);
                  setAgentOpen(true);
                }}
              >
                {isUtilityRoute ? null : children}
              </DynamicCrmCanvas>
            )}
          </FigmaCanvasFrame>
        </div>

        {/* TAB 2: BACKEND BLUEPRINTS */}
        <div
          className={cn(
            "h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[#09090b]",
            activeTab !== "backend" && "hidden",
          )}
        >
          <EditorShell
            config={currentConfig}
            canEditConfig={session.canEditConfig}
            onApplyPatches={applyEditorPatches}
            onAskAgent={openAgentWithPrompt}
          />
        </div>

        {/* Docked AI Agent Panel in Live Canvas or Blueprint Mode.
            Backend docks it exactly as the frontend does — a collapse rail
            instead of a panel header, so "Edit with agent" opens the same
            workspace in both tabs. */}
        {activeTab === "backend" && agentOpen && !isUtilityRoute && (
          <button
            type="button"
            onClick={() => setAgentOpen(false)}
            title="Hide AI agent panel"
            aria-label="Hide AI agent panel"
            className="flex w-6 shrink-0 items-center justify-center border-l border-zinc-800/80 bg-[#0c0c0e] text-zinc-500 transition-colors hover:text-white"
          >
            <PanelRightClose size={14} />
          </button>
        )}
        {(activeTab === "backend" || !isStudioHome) && agentOpen && !isUtilityRoute && (
          <AgentPanel
            config={currentConfig}
            counts={counts}
            canEditConfig={session.canEditConfig}
            initialPrompt={agentPrompt}
            hideHeader={activeTab === "backend"}
            onClose={() => setAgentOpen(false)}
            onApplied={(newConfig, firstViewId) => {
              if (newConfig) {
                setCurrentConfig(newConfig);
              }
              if (firstViewId) {
                router.push(`/views/${firstViewId}`);
              }
              router.refresh();
            }}
          />
        )}
        {activeTab === "backend" && !agentOpen && !isUtilityRoute && (
          <button
            type="button"
            onClick={() => setAgentOpen(true)}
            title="Show AI agent panel"
            className="absolute bottom-6 right-6 z-30 flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-xs font-medium text-white shadow-2xl transition-all hover:bg-zinc-800"
          >
            <Bot size={14} />
            <span>AI Agent</span>
          </button>
        )}
      </div>



      {themeModalOpen && <ThemeEditorModal
        isOpen={themeModalOpen}
        onClose={() => setThemeModalOpen(false)}
        theme={currentConfig.theme}
        onSave={async (theme) => {
          const result = await updateThemeAction(theme);
          if (result.success) router.refresh();
          return result;
        }}
      />}

      {/* Brand Customizer Modal */}
      {brandModalOpen && <BrandCustomizerModal
        isOpen={brandModalOpen}
        onClose={() => setBrandModalOpen(false)}
        brand={currentConfig.brand}
        onSave={async (b) => {
          const result = await updateBrandAction(b);
          if (!result.success) throw new Error(result.error || "Brand changes could not be saved. Try again.");
          router.refresh();
        }}
      />}

      {/* Custom Agents in CRM Modal */}
      {agentsModalOpen && <CustomAgentsModal
        isOpen={agentsModalOpen}
        onClose={() => setAgentsModalOpen(false)}
        customAgents={currentConfig.customAgents}
        onAddAgent={async (agent) => {
          const result = await addCustomAgentAction(agent);
          if (!result.success) throw new Error(result.error || "Instructions could not be saved. Try again.");
          router.refresh();
        }}
        onRemoveAgent={async (id) => {
          const result = await removeCustomAgentAction(id);
          if (!result.success) throw new Error(result.error || "Instructions could not be removed. Try again.");
          router.refresh();
        }}
        onAskAi={(prompt) => {
          setAgentPrompt(prompt);
          setAgentOpen(true);
        }}
      />}

      

      {/* Command Palette (⌘K) */}
      <CommandPalette
        objects={currentConfig.objects}
        views={currentConfig.views}
        actions={[
          { id: "studio", label: "Open studio", run: () => { setActiveTab("frontend"); router.push("/studio"); } },
          { id: "email", label: "Open email connection", run: () => router.push("/settings/email") },
          { id: "blueprints", label: "Open data & workflows", run: () => { setActiveTab("backend"); if (isUtilityRoute) router.push("/studio"); } },
          { id: "frontend", label: "Open builder", run: () => { setActiveTab("frontend"); if (isUtilityRoute) router.push("/studio"); } },
          { id: "import", label: "Import a spreadsheet", run: () => router.push("/settings/import") },
          { id: "history", label: "Open configuration history", run: () => router.push("/settings/history") },
        ]}
        results={results}
        searching={searching}
        error={searchError}
        onQueryChange={search}
        onOpenView={(viewId) => {
          setActiveTab("frontend");
          router.push(`/views/${viewId}`);
        }}
        onOpenRecord={(recordId) => {
          setActiveTab("frontend");
          router.push(`/records/${recordId}`);
        }}
        onAskAgent={(prompt) => {
          setAgentPrompt(prompt);
          if (isStudioHome && activeTab === "frontend") setStudioPanelOpen(true);
          else setAgentOpen(true);
        }}
      />
    </div>
  );
}
