"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search } from "lucide-react";
import type { ObjectConfig, ObjectKey, ViewConfig } from "@/lib/config/types";
import { cn } from "@/lib/utils";

/**
 * Cmd-K. In a keyboard product this is the primary navigation for power users,
 * and it is cheap to build once the config is queryable.
 */

export interface PaletteAction {
  id: string;
  label: string;
  run: () => void;
}

export interface PaletteResult {
  id: string;
  title: string;
  objectKey: ObjectKey;
}

export interface CommandPaletteProps {
  objects: ObjectConfig[];
  views: ViewConfig[];
  actions: PaletteAction[];
  /** The page owns fetching; the palette only says what was typed. */
  onQueryChange?: (query: string) => void;
  results?: PaletteResult[];
  searching?: boolean;
  error?: string;
  onOpenView?: (viewId: string) => void;
  onOpenRecord?: (recordId: string) => void;
  /** Opens the agent panel with this prompt already typed. */
  onAskAgent?: (prompt: string) => void;
}

export function CommandPalette({
  objects,
  views,
  actions,
  onQueryChange,
  results = [],
  searching,
  error,
  onOpenView,
  onOpenRecord,
  onAskAgent,
}: CommandPaletteProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlighted, setHighlighted] = React.useState(0);

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  React.useEffect(() => {
    onQueryChange?.(query);
    setHighlighted(0);
  }, [query, onQueryChange]);

  const objectByKey = React.useMemo(
    () => new Map(objects.map((object) => [object.key, object])),
    [objects],
  );

  const term = query.trim().toLowerCase();
  const matchingViews = views.filter((view) => !term || view.name.toLowerCase().includes(term));
  const matchingActions = actions.filter((action) => !term || action.label.toLowerCase().includes(term));

  const items: { key: string; label: string; hint: string; run: () => void }[] = [
    ...matchingViews.map((view) => ({
      key: `view-${view.id}`,
      label: view.name,
      hint: objectByKey.get(view.objectKey)?.labelPlural ?? view.objectKey,
      run: () => onOpenView?.(view.id),
    })),
    ...results.map((result) => ({
      key: `record-${result.id}`,
      label: result.title,
      hint: objectByKey.get(result.objectKey)?.label ?? result.objectKey,
      run: () => onOpenRecord?.(result.id),
    })),
    ...matchingActions.map((action) => ({
      key: `action-${action.id}`,
      label: action.label,
      hint: "Action",
      run: action.run,
    })),
    ...(term && onAskAgent
      ? [
          {
            key: "ask-agent",
            label: `Ask the agent to "${query.trim()}"`,
            hint: "Agent",
            run: () => onAskAgent(query.trim()),
          },
        ]
      : []),
  ];

  const choose = (index: number) => {
    const item = items[index];
    if (!item) return;
    item.run();
    setOpen(false);
    setQuery("");
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          className="fixed left-1/2 top-[15vh] z-50 w-[560px] max-w-[92vw] -translate-x-1/2 rounded-lg border border-edge bg-surface-raised shadow-lg"
          aria-label="Command palette"
        >
          <Dialog.Title className="sr-only">Search and jump</Dialog.Title>

          <div className="flex items-center gap-2 border-b border-edge px-4">
            <Search size={14} className="text-content-muted" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setHighlighted((current) => Math.max(0, Math.min(current + 1, items.length - 1)));
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setHighlighted((current) => Math.max(current - 1, 0));
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  choose(highlighted);
                }
              }}
              placeholder="Search records, jump to a view, or ask the agent"
              aria-label="Search"
              className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-content-muted"
            />
          </div>

          {error && <p role="alert" className="px-4 py-2 text-xs text-danger">{error}</p>}
          <ul className="max-h-[50vh] overflow-y-auto py-2" role="listbox" aria-label="Results">
            {searching && items.length === 0 ? (
              <li className="px-4 py-2 text-sm text-content-muted">Searching…</li>
            ) : items.length === 0 ? (
              <li className="px-4 py-2 text-sm text-content-muted">
                Nothing matches. Try a name, a view, or what you want to change.
              </li>
            ) : (
              items.map((item, index) => (
                <li key={item.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlighted}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => choose(index)}
                    className={cn(
                      "flex w-full items-center justify-between gap-4 px-4 py-2 text-left text-sm",
                      index === highlighted ? "bg-surface-hover" : "",
                    )}
                  >
                    <span className="truncate">{item.label}</span>
                    <span className="shrink-0 text-xs text-content-muted">{item.hint}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
