"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Check, ChevronDown, Database, GitBranch, LayoutDashboard, List, MessageSquare, Monitor, PanelRightClose, RotateCcw, Search, Sparkles, X } from "lucide-react";
import { ConfigDiff } from "@/components/agent/ConfigDiff";
import { KanbanView } from "@/components/renderers/KanbanView";
import { TableView } from "@/components/renderers/TableView";
import { FieldRenderer } from "@/components/renderers/FieldRenderer";
import { defaultConfig } from "@/lib/config/default";
import { applyPatches } from "@/lib/config/patch";
import { themeVars } from "@/lib/config/theme";
import { resolveView } from "@/lib/runtime/view";
import type { ConfigPatch, CrmRecord, ImpactSummary, Sort } from "@/lib/config/types";
import { StudioMark } from "./StudioMark";
import styles from "./demo.module.css";

const PATCHES: ConfigPatch[] = [
  { op: "add_field", objectKey: "deal", field: { id: "fld_renewal", key: "renewal_date", label: "Renewal date", type: "date", required: false, system: false } },
  { op: "create_view", view: { id: "vw_renewals", objectKey: "deal", name: "Upcoming renewals", renderer: "table", columns: ["fld_deal_name", "fld_deal_amount", "fld_renewal"] } },
];
const IMPACT: ImpactSummary = {
  items: [
    { description: "Add a renewal date to your deals", destructive: false, externalEffect: false },
    { description: "Create an Upcoming renewals view", destructive: false, externalEffect: false },
  ], hasDestructive: false, hasExternalEffects: false,
};
function deal(id: string, name: string, amount: number, stage: string, date: string): CrmRecord {
  return { id, objectKey: "deal", data: { fld_deal_name: name, fld_deal_amount: amount, fld_deal_stage: stage, fld_deal_close_date: date, fld_renewal: date }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
}
const RECORDS = [
  deal("1", "Orbit rebrand", 24000, "new", "2026-10-12"),
  deal("2", "Forma website", 18000, "new", "2026-10-16"),
  deal("3", "Kinfolk retainer", 36000, "qualified", "2026-10-20"),
  deal("4", "Acme launch", 12500, "qualified", "2026-10-22"),
  deal("5", "Layers expansion", 48000, "proposal", "2026-11-01"),
  deal("6", "Sonder identity", 32000, "negotiation", "2026-11-08"),
];

/** Public, in-memory demo. The real renderers and patch engine run on fixtures;
 * no requests, customer records, or AI calls are involved. */
export function HeroDemo() {
  const baseConfig = useMemo(() => defaultConfig(), []);
  const [config, setConfig] = useState(baseConfig);
  const [records, setRecords] = useState(RECORDS);
  const [tab, setTab] = useState<"frontend" | "backend">("frontend");
  const [viewId, setViewId] = useState("vw_deal_board");
  const [applied, setApplied] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const [mobileAgent, setMobileAgent] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>();
  const [selection, setSelection] = useState<string[]>([]);
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const view = useMemo(() => resolveView(config, viewId), [config, viewId]);
  const openRecord = records.find((record) => record.id === openRecordId);
  const shownRecords = useMemo(() => {
    const filtered = records.filter((record) => String(record.data.fld_deal_name).toLowerCase().includes(query.toLowerCase()));
    if (sort) filtered.sort((a, b) => {
      const av = a.data[sort.fieldId], bv = b.data[sort.fieldId];
      const comparison = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
      return sort.direction === "asc" ? comparison : -comparison;
    });
    return filtered;
  }, [records, query, sort]);
  useEffect(() => { if (openRecordId) dialog.current?.showModal(); }, [openRecordId]);

  function updateStage(id: string, stage: string) {
    setRecords((current) => current.map((record) => record.id === id ? { ...record, data: { ...record.data, fld_deal_stage: stage } } : record));
  }
  function applyDemo() {
    setConfig(applyPatches(baseConfig, PATCHES));
    setApplied(true);
    setViewId("vw_renewals");
    setTab("frontend");
    setMobileAgent(false);
    setQuery("");
  }
  function undoDemo() {
    setConfig(baseConfig); setApplied(false); setDiscarded(false); setViewId("vw_deal_board");
  }
  function selectView(id: string) { setViewId(id); setTab("frontend"); setMobileAgent(false); }

  return (
    <div className={styles.studio} data-density="app" style={themeVars() as React.CSSProperties}>
      <div className={styles.topbar}>
        <div className={styles.studioBrand}><StudioMark /><span>Studio</span><span className={styles.previewBadge}>Preview</span></div>
        <div className={styles.topTabs} role="group" aria-label="Studio preview mode">
          <button aria-pressed={tab === "frontend" && !mobileAgent} onClick={() => { setTab("frontend"); setMobileAgent(false); }}><LayoutDashboard size={13} /> Frontend</button>
          <button aria-pressed={tab === "backend" && !mobileAgent} onClick={() => { setTab("backend"); setMobileAgent(false); }}><GitBranch size={13} /> Backend</button>
        </div>
        <div className={styles.previewTools}><Monitor size={14} /><span>100%</span><span className={styles.topDivider} /><span className={styles.saved}><Check size={12} /> All changes saved</span></div>
        <button className={styles.agentToggle} aria-label={mobileAgent ? "Show workspace preview" : "Show AI agent preview"} aria-pressed={mobileAgent} onClick={() => setMobileAgent(!mobileAgent)}><MessageSquare size={15} /><span>AI</span></button>
      </div>
      <div className={`${styles.workspace} ${mobileAgent ? styles.showAgent : ""}`}>
        <aside className={styles.sidebar} aria-label="Sample workspace navigation">
          <div className={styles.projectIdentity}><span>N</span><div><strong>Northstar</strong><small>Creative workspace</small></div><ChevronDown size={12} /></div>
          <small className={styles.sidebarLabel}>Workspace</small>
          <button className={tab === "frontend" && viewId === "vw_deal_board" ? styles.activeNav : ""} onClick={() => selectView("vw_deal_board")}><LayoutDashboard size={14} /> Sales pipeline</button>
          <button className={tab === "frontend" && viewId === "vw_deals" ? styles.activeNav : ""} onClick={() => selectView("vw_deals")}><List size={14} /> All deals<span>{records.length}</span></button>
          {applied && <button className={viewId === "vw_renewals" ? styles.activeNav : ""} onClick={() => selectView("vw_renewals")}><RotateCcw size={14} /> Renewals</button>}
          <small className={styles.sidebarLabel}>Behind the scenes</small>
          <button className={tab === "backend" ? styles.activeNav : ""} onClick={() => setTab("backend")}><Database size={14} /> Your data</button>
          <div className={styles.sidebarFooter}><span>JD</span><div>Jamie Davis<small>Sample workspace</small></div></div>
        </aside>
        <div className={styles.canvas}>
          {tab === "frontend" ? <>
            <div className={styles.canvasHeading}><div><span className={styles.breadcrumb}>Northstar <span>/</span> Workspace</span><h3>{viewId === "vw_deal_board" ? "Your next big things." : view.view.name}</h3><p>{applied && viewId === "vw_renewals" ? "A new view, created from one conversation." : "Good relationships. Great work. All moving forward."}</p></div><span className={styles.memberAvatar}>JD</span></div>
            <div className={styles.canvasToolbar}>
              <div className={styles.viewSwitch} role="group" aria-label="Deal view">
                <button aria-label="Board view" aria-pressed={viewId === "vw_deal_board"} onClick={() => selectView("vw_deal_board")}><LayoutDashboard size={13} /><span>Board</span></button>
                <button aria-label="Table view" aria-pressed={viewId !== "vw_deal_board"} onClick={() => selectView(applied ? "vw_renewals" : "vw_deals")}><List size={13} /><span>Table</span></button>
              </div>
              <label className={styles.search}><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a deal…" aria-label="Search sample deals" /></label>
              <span className={styles.dealCount}>{shownRecords.length} deals</span>
            </div>
            <div className={styles.records}>
              {view.renderer === "kanban" && <KanbanView {...view} pipeline={{ ...view.pipeline, stages: view.pipeline.stages.filter((stage) => !stage.isLost && !stage.isWon) }} records={shownRecords} onStageChange={updateStage} onOpenRecord={setOpenRecordId} />}
              {view.renderer === "table" && <TableView {...view} records={shownRecords} total={shownRecords.length} onSortChange={setSort} selectedIds={selection} onSelectionChange={setSelection} onOpenRecord={setOpenRecordId} columnWidths={{ fld_deal_name: 180, fld_deal_amount: 110, fld_deal_stage: 110, fld_deal_close_date: 130, fld_deal_company: 120, fld_renewal: 140 }} />}
            </div>
            <div className={styles.canvasFoot}><span>{viewId === "vw_deal_board" ? "Move a deal. Make it happen." : "Your data, with a fresh perspective."}</span><span>Sample data</span></div>
          </> : <div className={styles.backend}>
            <span className={styles.breadcrumb}>Northstar <span>/</span> Backend</span><h3>A place for everything.</h3><p>The structure behind your workspace.</p>
            <div className={styles.schemaGrid}>{config.objects.map((object) => <section key={object.key} className={styles.schemaObject}><header><Database size={14} /><strong>{object.labelPlural}</strong><span>{object.fields.length} fields</span></header><div>{[...object.fields.slice(0, 3), ...object.fields.filter((field) => field.id === "fld_renewal")].map((field) => <div key={field.id}><span>{field.label}</span><small>{field.type}</small></div>)}</div></section>)}</div>
            <div className={styles.schemaNote}><GitBranch size={15} /> {config.relations.length} relationships connect your workspace.</div>
          </div>}
        </div>
        <aside className={styles.agent} aria-label="Interactive AI configuration example">
          <div className={styles.agentHeader}><span><span className={styles.agentOrb} /> AI Architect</span><PanelRightClose size={14} aria-hidden="true" /></div>
          <div className={styles.agentConversation}>
            <span className={styles.conversationLabel}>Your workspace, in your words</span>
            <div className={styles.userMessage}>Add a renewal date to my deals, and a view to keep track of them.</div>
            <div className={styles.agentReply}><span className={styles.smallOrb} /><div><strong>A little more clarity. Done.</strong><p>I’ll add the field and give your upcoming renewals a space of their own.</p></div></div>
            {discarded ? <div className={styles.discarded}><p>Example discarded. Your preview is unchanged.</p><button onClick={() => setDiscarded(false)}>Try the example again</button></div> : <ConfigDiff patches={PATCHES} impact={IMPACT} onConfirm={applyDemo} onDiscard={() => setDiscarded(true)} onUndo={undoDemo} status={applied ? "applied" : "ready"} />}
            <p className={styles.demoHint} role="status">{applied ? "Your new view is ready. You can undo this change." : "Try it. This example only changes the preview."}</p>
          </div>
          <div className={styles.agentFooter}><span><AudioLines size={15} /> A workspace that listens.</span><Sparkles size={14} /></div>
        </aside>
      </div>
      <dialog ref={dialog} className={styles.recordDialog} onClose={() => setOpenRecordId(null)} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }} aria-labelledby="sample-record-title">
        {openRecord && <><header><div><span>Sample deal</span><h3 id="sample-record-title">{String(openRecord.data.fld_deal_name)}</h3></div><button aria-label="Close deal" onClick={() => dialog.current?.close()}><X size={19} /></button></header><div className={styles.recordFields}>{config.objects.find((object) => object.key === "deal")?.fields.filter((field) => ["fld_deal_amount", "fld_deal_close_date", "fld_renewal"].includes(field.id)).map((field) => <div key={field.id}><span>{field.label}</span><FieldRenderer field={field} value={openRecord.data[field.id]} mode="read" /></div>)}<label>Stage<select value={String(openRecord.data.fld_deal_stage)} onChange={(event) => updateStage(openRecord.id, event.target.value)}>{baseConfig.pipelines[0]?.stages.filter((stage) => !stage.isWon && !stage.isLost).map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}</select></label></div><p>Explore freely. Changes stay in this sample workspace.</p></>}
      </dialog>
    </div>
  );
}
