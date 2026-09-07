"use client";

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronRight,
  Database,
  LayoutDashboard,
  Plus,
  Search,
  Trash2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { CONTAINER_KINDS } from "@/lib/config/controls";
import {
  studioEyebrow,
  studioInput,
  studioNavItem,
  studioNavItemActive,
  studioNavItemIdle,
} from "@/components/builder/studio-chrome";
import { cn } from "@/lib/utils";
import { describeStep, describeTrigger, nodeLabel, screenSummary } from "./describe";
import { pathOf, ROOT } from "./node-tree";
import { laneAt } from "./step-tree";
import { sameSelection, type Section, type Selection } from "./selection";
import type { AutomationConfig, Config, ScreenConfig, UiNode } from "@/lib/config/types";

/**
 * The left rail: everything this workspace is made of, as one tree.
 *
 * Shopify's editor works because the structure is a list you can see and
 * rearrange, and the settings for whatever you picked are beside it. The old
 * backend had a nav with four counts and no structure at all, so the only way
 * to find a field was to open its object and read a page.
 */

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "data", label: "Data", icon: Database },
  { id: "screens", label: "Screens", icon: LayoutDashboard },
  { id: "workflows", label: "Workflows", icon: Workflow },
];

export function StructureTree({
  config,
  section,
  selection,
  canEdit,
  onSection,
  onSelect,
  onAddWorkflow,
  onAddNode,
  onRemoveNode,
  onMoveNode,
}: {
  config: Config;
  section: Section;
  selection: Selection | null;
  canEdit: boolean;
  onSection: (section: Section) => void;
  onSelect: (selection: Selection) => void;
  onAddWorkflow: () => void;
  onAddNode: (screenId: string, parentPath: string) => void;
  onRemoveNode: (screenId: string, path: string) => void;
  onMoveNode: (screenId: string, parentPath: string, from: number, to: number) => void;
}) {
  const [query, setQuery] = React.useState("");
  const needle = query.trim().toLowerCase();
  const matches = (...values: (string | undefined)[]) =>
    !needle || values.some((value) => value?.toLowerCase().includes(needle));

  const counts: Record<Section, number> = {
    data: config.objects.length,
    screens: (config.screens ?? []).length,
    workflows: config.automations.length,
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-800/80 bg-[#0c0c0e]">
      <nav className="shrink-0 space-y-0.5 p-2.5" aria-label="Workspace sections">
        {SECTIONS.map((entry) => {
          const Icon = entry.icon;
          const active = section === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              aria-current={active ? "page" : undefined}
              className={cn(studioNavItem, active ? studioNavItemActive : studioNavItemIdle)}
              onClick={() => onSection(entry.id)}
            >
              <Icon size={14} className={active ? "text-white" : "text-zinc-400"} aria-hidden="true" />
              <span className="flex-1">{entry.label}</span>
              <span className="font-mono text-[10px] tabular-nums text-zinc-500">{counts[entry.id]}</span>
            </button>
          );
        })}
      </nav>

      <div className="relative shrink-0 px-2.5 pb-2">
        <Search size={13} className="pointer-events-none absolute left-4.5 top-1.5 text-zinc-600" aria-hidden="true" />
        <input
          className={studioInput}
          value={query}
          placeholder={`Search ${section}`}
          aria-label={`Search ${section}`}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {section === "data" &&
          config.objects
            .filter((object) =>
              matches(object.label, object.labelPlural, ...object.fields.map((field) => field.label)),
            )
            .map((object) => (
              <Branch
                key={object.key}
                label={object.labelPlural}
                detail={`${object.fields.length} fields`}
                selected={selection?.kind === "object" && selection.objectKey === object.key}
                onSelect={() => onSelect({ kind: "object", objectKey: object.key })}
                defaultOpen={selection?.kind === "field" && selection.objectKey === object.key}
              >
                {object.fields
                  .filter((field) => matches(field.label))
                  .map((field) => (
                    <Leaf
                      key={field.id}
                      label={field.label}
                      selected={selection?.kind === "field" && selection.fieldId === field.id}
                      onSelect={() => onSelect({ kind: "field", objectKey: object.key, fieldId: field.id })}
                    />
                  ))}
              </Branch>
            ))}

        {section === "screens" &&
          (config.screens ?? [])
            .filter((screen) => matches(screen.name, screenSummary(screen)))
            .map((screen) => (
              <ScreenBranch
                key={screen.id}
                screen={screen}
                selection={selection}
                canEdit={canEdit}
                onSelect={onSelect}
                onAddNode={onAddNode}
                onRemoveNode={onRemoveNode}
                onMoveNode={onMoveNode}
              />
            ))}

        {section === "workflows" && (
          <>
            {config.automations
              .filter((automation) => matches(automation.name, describeTrigger(automation, config)))
              .map((automation) => (
                <WorkflowBranch
                  key={automation.id}
                  automation={automation}
                  config={config}
                  selection={selection}
                  onSelect={onSelect}
                />
              ))}
            {canEdit && (
              <button
                type="button"
                className="mt-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-400 transition-colors hover:bg-zinc-900/60 hover:text-zinc-200"
                onClick={onAddWorkflow}
              >
                <Plus size={13} aria-hidden="true" />
                New workflow
              </button>
            )}
          </>
        )}

        {section === "data" && config.objects.length === 0 && <Empty>Nothing here yet.</Empty>}
        {section === "screens" && (config.screens ?? []).length === 0 && (
          <Empty>No screens yet. Ask the agent to build one, then shape it here.</Empty>
        )}
        {section === "workflows" && config.automations.length === 0 && (
          <Empty>No workflows yet. Start one and it runs the moment you turn it on.</Empty>
        )}
      </div>
    </aside>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 py-3 text-[11px] leading-relaxed text-zinc-600">{children}</p>;
}

const rowClass =
  "flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-1.5 text-left text-[11px] transition-colors";

function Branch({
  label,
  detail,
  selected,
  defaultOpen,
  onSelect,
  children,
  actions,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  defaultOpen?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen ?? false);

  return (
    <div className="mb-0.5">
      <div
        className={cn(
          rowClass,
          "group/branch pl-1",
          selected ? "bg-zinc-800/90 text-white" : "text-zinc-300 hover:bg-zinc-900/60",
        )}
      >
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-zinc-600 hover:text-zinc-300"
          aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronRight size={12} className={cn("transition-transform", open && "rotate-90")} />
        </button>
        <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={onSelect}>
          {label}
        </button>
        {detail && (
          <span className="shrink-0 font-mono text-[10px] text-zinc-600 group-hover/branch:hidden">{detail}</span>
        )}
        {actions}
      </div>
      {open && <div className="ml-3 border-l border-zinc-800/70 pl-1.5">{children}</div>}
    </div>
  );
}

function Leaf({
  label,
  detail,
  selected,
  onSelect,
  actions,
  handle,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onSelect: () => void;
  actions?: React.ReactNode;
  handle?: Record<string, unknown>;
}) {
  return (
    <div
      className={cn(
        rowClass,
        "group/leaf pl-2",
        selected ? "bg-zinc-800/90 text-white" : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200",
      )}
      {...handle}
    >
      <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={onSelect}>
        {label}
        {detail && <span className="ml-1.5 text-zinc-600">{detail}</span>}
      </button>
      {actions}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Screens — the node tree, reorderable inside each container                  */
/* -------------------------------------------------------------------------- */

function ScreenBranch({
  screen,
  selection,
  canEdit,
  onSelect,
  onAddNode,
  onRemoveNode,
  onMoveNode,
}: {
  screen: ScreenConfig;
  selection: Selection | null;
  canEdit: boolean;
  onSelect: (selection: Selection) => void;
  onAddNode: (screenId: string, parentPath: string) => void;
  onRemoveNode: (screenId: string, path: string) => void;
  onMoveNode: (screenId: string, parentPath: string, from: number, to: number) => void;
}) {
  // A coded screen has no blocks to expand — it is one component, and the
  // centre pane shows it. Drawing an empty tree beside it would suggest there
  // is structure here to rearrange when there is not.
  if (!screen.root) {
    return (
      <Leaf
        label={screen.name}
        detail="code"
        selected={selection?.kind === "screen" && selection.screenId === screen.id}
        onSelect={() => onSelect({ kind: "screen", screenId: screen.id })}
      />
    );
  }

  return (
    <Branch
      label={screen.name}
      detail={`${(screen.root.children ?? []).length}`}
      selected={selection?.kind === "screen" && selection.screenId === screen.id}
      defaultOpen={selection?.kind === "node" && selection.screenId === screen.id}
      onSelect={() => onSelect({ kind: "screen", screenId: screen.id })}
    >
      <NodeChildren
        parent={screen.root}
        parentPath={ROOT}
        screenId={screen.id}
        selection={selection}
        canEdit={canEdit}
        onSelect={onSelect}
        onAddNode={onAddNode}
        onRemoveNode={onRemoveNode}
        onMoveNode={onMoveNode}
      />
    </Branch>
  );
}

function NodeChildren({
  parent,
  parentPath,
  screenId,
  selection,
  canEdit,
  onSelect,
  onAddNode,
  onRemoveNode,
  onMoveNode,
}: {
  parent: UiNode;
  parentPath: string;
  screenId: string;
  selection: Selection | null;
  canEdit: boolean;
  onSelect: (selection: Selection) => void;
  onAddNode: (screenId: string, parentPath: string) => void;
  onRemoveNode: (screenId: string, path: string) => void;
  onMoveNode: (screenId: string, parentPath: string, from: number, to: number) => void;
}) {
  const children = parent.children ?? [];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = children.map((child, index) => child.id ?? `${parentPath}#${index}`);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onMoveNode(screenId, parentPath, from, to);
  };

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {children.map((child, index) => (
            <SortableNodeRow
              key={ids[index]}
              id={ids[index]!}
              node={child}
              path={pathOf([...indicesOf(parentPath), index])}
              screenId={screenId}
              selection={selection}
              canEdit={canEdit}
              onSelect={onSelect}
              onAddNode={onAddNode}
              onRemoveNode={onRemoveNode}
              onMoveNode={onMoveNode}
            />
          ))}
        </SortableContext>
      </DndContext>

      {canEdit && CONTAINER_KINDS.has(parent.kind) && (
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-lg py-1 pl-2 text-left text-[11px] text-zinc-600 transition-colors hover:bg-zinc-900/60 hover:text-zinc-300"
          onClick={() => onAddNode(screenId, parentPath)}
        >
          <Plus size={11} aria-hidden="true" />
          Add block
        </button>
      )}
    </>
  );
}

function indicesOf(path: string): number[] {
  return path
    .split(".")
    .filter((part) => /^\d+$/.test(part))
    .map(Number);
}

function SortableNodeRow({
  id,
  node,
  path,
  screenId,
  selection,
  canEdit,
  onSelect,
  onAddNode,
  onRemoveNode,
  onMoveNode,
}: {
  id: string;
  node: UiNode;
  path: string;
  screenId: string;
  selection: Selection | null;
  canEdit: boolean;
  onSelect: (selection: Selection) => void;
  onAddNode: (screenId: string, parentPath: string) => void;
  onRemoveNode: (screenId: string, path: string) => void;
  onMoveNode: (screenId: string, parentPath: string, from: number, to: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canEdit,
  });
  const selected = sameSelection(selection, { kind: "node", screenId, path });
  const container = CONTAINER_KINDS.has(node.kind);

  const remove = canEdit ? (
    <button
      type="button"
      className="hidden shrink-0 text-zinc-700 transition-colors hover:text-red-400 group-hover/leaf:block group-hover/branch:block"
      title={`Remove ${nodeLabel(node)}`}
      aria-label={`Remove ${nodeLabel(node)}`}
      onClick={(event) => {
        event.stopPropagation();
        onRemoveNode(screenId, path);
      }}
    >
      <Trash2 size={11} />
    </button>
  ) : null;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "opacity-70")}
    >
      {container ? (
        <Branch
          label={nodeLabel(node)}
          detail={node.kind}
          selected={selected}
          defaultOpen={selection?.kind === "node" && selection.path.startsWith(`${path}.`)}
          onSelect={() => onSelect({ kind: "node", screenId, path })}
          actions={
            <>
              {remove}
              <span {...attributes} {...listeners} className="sr-only" />
            </>
          }
        >
          <NodeChildren
            parent={node}
            parentPath={path}
            screenId={screenId}
            selection={selection}
            canEdit={canEdit}
            onSelect={onSelect}
            onAddNode={onAddNode}
            onRemoveNode={onRemoveNode}
            onMoveNode={onMoveNode}
          />
        </Branch>
      ) : (
        <Leaf
          label={nodeLabel(node)}
          selected={selected}
          onSelect={() => onSelect({ kind: "node", screenId, path })}
          handle={{ ...attributes, ...listeners }}
          actions={remove}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Workflows                                                                   */
/* -------------------------------------------------------------------------- */

function WorkflowBranch({
  automation,
  config,
  selection,
  onSelect,
}: {
  automation: AutomationConfig;
  config: Config;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
}) {
  const open =
    selection?.kind === "step" || selection?.kind === "trigger"
      ? selection.automationId === automation.id
      : false;

  return (
    <Branch
      label={automation.name}
      detail={automation.enabled ? "on" : "off"}
      selected={selection?.kind === "workflow" && selection.automationId === automation.id}
      defaultOpen={open}
      onSelect={() => onSelect({ kind: "workflow", automationId: automation.id })}
    >
      <Leaf
        label={describeTrigger(automation, config)}
        selected={selection?.kind === "trigger" && selection.automationId === automation.id}
        onSelect={() => onSelect({ kind: "trigger", automationId: automation.id })}
      />
      {laneAt(automation.steps, []).map((step, index) => (
        <Leaf
          key={step.id}
          label={describeStep(step, config).title}
          selected={
            selection?.kind === "step" &&
            selection.automationId === automation.id &&
            selection.index === index &&
            selection.lane.length === 0
          }
          onSelect={() => onSelect({ kind: "step", automationId: automation.id, lane: [], index })}
        />
      ))}
    </Branch>
  );
}
