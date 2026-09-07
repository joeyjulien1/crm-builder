"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { studioEyebrow } from "@/components/builder/studio-chrome";
import { TextInput } from "./controls";
import { nodeLabel, screenDataSources, screenSummary } from "./describe";
import { pathOf, ROOT } from "./node-tree";
import type { Selection } from "./selection";
import type { Config, ScreenConfig, UiNode } from "@/lib/config/types";

/**
 * The centre pane for a screen: its shape, at a glance, clickable.
 *
 * This is a wireframe rather than the real thing. The live renderer needs
 * records resolved on the server for every data node, and a backend editor that
 * waits on a round trip per click is not an editor. What matters here is
 * *where things are and what they read* — a table of deals in the left column,
 * a metric row across the top — which the wireframe says without any data.
 *
 * The frontend Build tab remains the place to see the screen for real.
 */
export function ScreenView({
  screen,
  config,
  selection,
  canEdit,
  onSelect,
  onRename,
  onRewrite,
}: {
  screen: ScreenConfig;
  config: Config;
  selection: Selection | null;
  canEdit: boolean;
  onSelect: (selection: Selection) => void;
  onRename: (name: string) => void;
  onRewrite: (source: string) => void;
}) {
  const selectedPath = selection?.kind === "node" && selection.screenId === screen.id ? selection.path : null;
  const reads = screenDataSources(screen);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
      <header>
        <div className="max-w-xs">
          <TextInput
            value={screen.name}
            disabled={!canEdit}
            maxLength={60}
            onCommit={(name) => name.trim() && onRename(name.trim())}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-500">
          {screenSummary(screen)}
          {reads.length > 0 && ` · reads ${reads.join(", ")}`}
        </p>
      </header>

      {screen.source !== undefined ? (
        <section>
          <p className={cn(studioEyebrow, "mb-2")}>Component</p>
          <SourceEditor
            key={screen.id}
            source={screen.source}
            canEdit={canEdit}
            onCommit={onRewrite}
          />
          <p className="mt-2 text-[11px] text-zinc-600">
            This screen is a React component. The Build tab runs it against real records; a mistake shows
            there as a message with the line in it, not a blank page.
          </p>
        </section>
      ) : screen.root ? (
        <section>
          <p className={cn(studioEyebrow, "mb-2")}>Layout</p>
          <div className="rounded-xl border border-zinc-800 bg-[#0c0c0e] p-3">
            <WireNode
              node={screen.root}
              path={ROOT}
              config={config}
              selectedPath={selectedPath}
              onSelect={(path) => onSelect({ kind: "node", screenId: screen.id, path })}
            />
          </div>
          <p className="mt-2 text-[11px] text-zinc-600">
            Click a block to edit it. The Build tab shows this screen with real records in it.
          </p>
        </section>
      ) : null}
    </div>
  );
}

const CONTAINERS = new Set<UiNode["kind"]>(["stack", "grid", "card", "section", "panel", "tabs", "tab"]);
const DATA_KINDS = new Set<UiNode["kind"]>(["table", "board", "list", "chart", "form", "record_detail"]);

function WireNode({
  node,
  path,
  config,
  selectedPath,
  onSelect,
}: {
  node: UiNode;
  path: string;
  config: Config;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const selected = selectedPath === path;
  const children = node.children ?? [];
  const isContainer = CONTAINERS.has(node.kind);
  const isRow = node.kind === "stack" && node.direction === "row";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group/wire relative rounded-lg border p-2 transition-colors",
        selected
          ? "border-zinc-400 bg-zinc-900/60"
          : "border-zinc-800/70 hover:border-zinc-600 hover:bg-zinc-900/30",
        isContainer ? "min-h-[3rem]" : "",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(path);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onSelect(path);
        }
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] text-zinc-300">{nodeLabel(node)}</span>
        <span className="shrink-0 font-mono text-[10px] uppercase text-zinc-600">{node.kind}</span>
      </div>

      {DATA_KINDS.has(node.kind) && <DataPlaceholder node={node} config={config} />}

      {children.length > 0 && (
        <div
          className={cn(
            "mt-2",
            node.kind === "grid"
              ? "grid gap-2"
              : isRow
                ? "flex flex-row gap-2"
                : "flex flex-col gap-2",
          )}
          style={node.kind === "grid" ? { gridTemplateColumns: `repeat(${node.cols ?? 3}, minmax(0, 1fr))` } : undefined}
        >
          {children.map((child, index) => (
            <div key={child.id ?? index} className={isRow ? "min-w-0 flex-1" : "min-w-0"}>
              <WireNode
                node={child}
                path={pathOf([...indices(path), index])}
                config={config}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            </div>
          ))}
        </div>
      )}

      {isContainer && children.length === 0 && (
        <p className="mt-1 text-[11px] text-zinc-700">Empty — add something to it from the tree.</p>
      )}
    </div>
  );
}

/**
 * A coded screen, editable by hand.
 *
 * Deliberately a plain textarea rather than an editor with a language server in
 * it: the agent writes these, a person nudges one, and the compile error the
 * Build tab shows is a better teacher than a squiggle would be. It commits on
 * blur like every other control here — one patch, one version.
 */
function SourceEditor({
  source,
  canEdit,
  onCommit,
}: {
  source: string;
  canEdit: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = React.useState(source);
  React.useEffect(() => setDraft(source), [source]);
  const lines = draft.split(String.fromCharCode(10)).length;

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        className="min-h-[24rem] w-full resize-y rounded-xl border border-zinc-800 bg-[#0c0c0e] p-3 font-mono text-[11px] leading-relaxed text-zinc-200 focus:border-zinc-600 focus:outline-none"
        spellCheck={false}
        value={draft}
        disabled={!canEdit}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== source) onCommit(draft);
        }}
      />
      <p className="text-[11px] text-zinc-600">
        {lines} {lines === 1 ? "line" : "lines"} · saves when you click away
      </p>
    </div>
  );
}

function indices(path: string): number[] {
  return path
    .split(".")
    .filter((part) => /^\d+$/.test(part))
    .map(Number);
}

/** A few grey bars standing in for whatever this node reads. */
function DataPlaceholder({ node, config }: { node: UiNode; config: Config }) {
  const objectKey = node.query?.objectKey ?? node.objectKey;
  const object = config.objects.find((candidate) => candidate.key === objectKey);
  const columns = node.columns ?? node.fields ?? [];
  const width = Math.min(Math.max(columns.length, 3), 5);

  return (
    <div className="mt-2 flex flex-col gap-1" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-1">
          {Array.from({ length: width }).map((_, column) => (
            <span
              key={column}
              className={cn("h-1.5 flex-1 rounded-full", row === 0 ? "bg-zinc-700" : "bg-zinc-800")}
            />
          ))}
        </div>
      ))}
      {object && (
        <span className="mt-0.5 text-[10px] text-zinc-600">
          {object.labelPlural}
          {node.query?.filters?.conditions?.length ? ", filtered" : ""}
        </span>
      )}
    </div>
  );
}
