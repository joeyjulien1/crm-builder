"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AudioLines, Bot, ChevronDown, Database, Download, FilePlus, History, Layout, LogOut, Mail, MessageSquare, Monitor, Palette, Search, Smartphone, Tablet, Upload } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ViewportMode } from "./FigmaCanvasFrame";
import type { BrandConfig } from "@/lib/config/types";
import styles from "./BuilderTopBar.module.css";

interface BuilderTopBarProps {
  tenantName: string;
  brand?: BrandConfig;
  customAgentsCount?: number;
  activeTab: "frontend" | "backend";
  onTabChange: (tab: "frontend" | "backend") => void;
  viewport: ViewportMode;
  onViewportChange: (viewport: ViewportMode) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onResetToBlank?: () => void;
  onOpenBrandModal?: () => void;
  onOpenThemeModal?: () => void;
  onOpenAgentsModal?: () => void;
  onSignOut?: () => void;
  agentOpen: boolean;
  onToggleAgent: () => void;
  onOpenSearch: () => void;
}

export function BuilderTopBar({ tenantName, activeTab, onTabChange, viewport, onViewportChange, onResetToBlank, onOpenBrandModal, onOpenThemeModal, onOpenAgentsModal, onSignOut, agentOpen, onToggleAgent, onOpenSearch }: BuilderTopBarProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const pathname = usePathname();
  const inSettings = pathname.startsWith("/settings/");
  const [modifier, setModifier] = React.useState("Ctrl");
  React.useEffect(() => { if (/Mac|iPhone|iPad/.test(navigator.platform)) setModifier("⌘"); }, []);
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "1" || event.key === "2") {
        event.preventDefault(); onTabChange(event.key === "1" ? "frontend" : "backend");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onTabChange]);
  const run = (action?: () => void) => { setMenuOpen(false); action?.(); };
  return (
    <header className={styles.header}>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button className={styles.workspace} aria-label="Open workspace navigation"><AudioLines size={22} /><span><strong>{tenantName}</strong><small>CRM Studio</small></span><ChevronDown size={14} /></button>
        </PopoverTrigger>
        <PopoverContent align="start" className={styles.menu}>
          <div className={styles.menuHeading}>Workspace</div>
          <nav aria-label="Workspace navigation">
            {[["/studio", "Studio", Layout], ["/settings/import", "Import data", Upload], ["/settings/email", "Email connection", Mail], ["/settings/history", "Change history", History]] .map(([href, label, Icon]) => {
              const MenuIcon = Icon as typeof Layout;
              return <Link key={href as string} href={href as string} aria-current={pathname === href ? "page" : undefined} onClick={() => setMenuOpen(false)}><MenuIcon size={16} />{label as string}</Link>;
            })}
            <a href="/api/export" download onClick={() => setMenuOpen(false)}><Download size={16} />Download workspace backup</a>
          </nav>
          {onResetToBlank && (
            <button onClick={() => run(onResetToBlank)}><FilePlus size={16} />Start a new project</button>
          )}
          <div className={styles.menuHeading}>Customize</div>
          {onOpenBrandModal && <button onClick={() => run(onOpenBrandModal)}><AudioLines size={16} />Brand identity</button>}
          {onOpenThemeModal && <button onClick={() => run(onOpenThemeModal)}><Palette size={16} />Theme and appearance</button>}
          {onOpenAgentsModal && <button onClick={() => run(onOpenAgentsModal)}><Bot size={16} />Agent instructions</button>}
          {onSignOut && <button className={styles.signOut} onClick={() => run(onSignOut)}><LogOut size={16} />Sign out</button>}
        </PopoverContent>
      </Popover>
      <div className={styles.tabs} role="group" aria-label="Studio mode">
        <button aria-pressed={!inSettings && activeTab === "frontend"} onClick={() => onTabChange("frontend")}><Layout size={15} /><span>Build</span><kbd>{modifier}1</kbd></button>
        <button aria-pressed={!inSettings && activeTab === "backend"} onClick={() => onTabChange("backend")}><Database size={15} /><span>Data & workflows</span><kbd>{modifier}2</kbd></button>
      </div>
      <div className={styles.tools}>
        {!inSettings && activeTab === "frontend" && <div className={styles.devices} role="group" aria-label="Preview size">{([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([mode, Icon]) => <button key={mode} aria-label={`${mode} preview`} title={`${mode} preview`} aria-pressed={viewport === mode} onClick={() => onViewportChange(mode)}><Icon size={15} /></button>)}</div>}
        <button aria-label="Search records and commands" title={`Search (${modifier}+K)`} onClick={onOpenSearch}><Search size={17} /></button>
        <button aria-label={agentOpen ? "Hide AI agent" : "Show AI agent"} title={agentOpen ? "Hide AI agent" : "Show AI agent"} aria-pressed={agentOpen} onClick={onToggleAgent}><MessageSquare size={17} /><span className={styles.toolLabel}>Agent</span></button>
      </div>
    </header>
  );
}
