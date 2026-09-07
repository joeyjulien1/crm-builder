"use client";

import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { CrmRecord, FieldConfig, Sort, ViewConfig } from "@/lib/config/types";
import { defaultColumnWidth, isNumericField } from "@/lib/runtime/field";
import { FieldRenderer, type FieldLookup } from "./FieldRenderer";
import { EmptyState, ErrorState, SkeletonRows } from "./states";
import { cn } from "@/lib/utils";

/**
 * The workhorse. Most users spend most of their day here, so it is dense,
 * keyboard-driven, and virtualised from the start — retrofitting
 * virtualisation into a table with inline editing is miserable.
 *
 * It does not fetch. Data arrives as props, which is what makes it testable
 * against fixture config.
 */

/**
 * Fallback only. The real row height is the theme's, read from --row-h below —
 * these two disagreeing is what made rows overlap when a tenant chose a taller
 * row: the DOM used the variable while the virtualiser kept assuming 34.
 */
const FALLBACK_ROW_HEIGHT = 34;

/** Reads --row-h off the element the rows actually live in. */
function useRowHeight(ref: React.RefObject<HTMLElement | null>): number {
  const [height, setHeight] = React.useState(FALLBACK_ROW_HEIGHT);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const value = getComputedStyle(element).getPropertyValue("--row-h").trim();
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) setHeight(parsed);
  }, [ref]);

  return height;
}
const OVERSCAN = 8;
const VIRTUALISE_ABOVE = 100;
const SELECT_COLUMN_WIDTH = 32;

export interface TableViewProps {
  view: ViewConfig;
  columns: FieldConfig[];
  records: CrmRecord[];
  total: number;
  status?: "loading" | "error" | "ready";
  error?: string;
  onRetry?: () => void;
  columnWidths?: Record<string, number>;
  onColumnWidthChange?: (fieldId: string, width: number) => void;
  onSortChange?: (sort: Sort) => void;
  onEditCommit?: (recordId: string, fieldId: string, value: unknown) => void;
  onOpenRecord?: (recordId: string) => void;
  onCreate?: () => void;
  onImport?: () => void;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  lookup?: FieldLookup;
  emptyTitle?: string;
}

export function TableView({
  view,
  columns,
  records,
  total,
  status = "ready",
  error,
  onRetry,
  columnWidths,
  onColumnWidthChange,
  onSortChange,
  onEditCommit,
  onOpenRecord,
  onCreate,
  onImport,
  selectedIds,
  onSelectionChange,
  lookup,
  emptyTitle,
}: TableViewProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const rowHeight = useRowHeight(scrollRef);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(600);
  const [editing, setEditing] = React.useState<{ recordId: string; fieldId: string } | null>(null);
  const [draft, setDraft] = React.useState<unknown>(null);
  const lastSelectedIndex = React.useRef<number | null>(null);

  const widths = React.useMemo(() => {
    const resolved: Record<string, number> = {};
    for (const column of columns) {
      resolved[column.id] = columnWidths?.[column.id] ?? defaultColumnWidth(column);
    }
    return resolved;
  }, [columns, columnWidths]);

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const virtualise = records.length > VIRTUALISE_ABOVE;
  const first = virtualise ? Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN) : 0;
  const last = virtualise
    ? Math.min(records.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN)
    : records.length;
  const visible = records.slice(first, last);

  const selected = React.useMemo(() => new Set(selectedIds ?? []), [selectedIds]);

  const toggleRow = (recordId: string, index: number, shiftKey: boolean) => {
    if (!onSelectionChange) return;
    const next = new Set(selected);

    if (shiftKey && lastSelectedIndex.current !== null) {
      const from = Math.min(lastSelectedIndex.current, index);
      const to = Math.max(lastSelectedIndex.current, index);
      for (let i = from; i <= to; i++) {
        const row = records[i];
        if (row) next.add(row.id);
      }
    } else if (next.has(recordId)) {
      next.delete(recordId);
    } else {
      next.add(recordId);
    }

    lastSelectedIndex.current = index;
    onSelectionChange([...next]);
  };

  const startEditing = (recordId: string, field: FieldConfig, value: unknown) => {
    if (!onEditCommit) return;
    setEditing({ recordId, fieldId: field.id });
    setDraft(value);
  };

  const commitEdit = (recordId: string, fieldId: string, value: unknown) => {
    setEditing(null);
    onEditCommit?.(recordId, fieldId, value);
  };

  if (status === "error") {
    return <ErrorState message={error ?? "This view could not load."} onRetry={onRetry} className="h-full" />;
  }

  const gridTemplate = [
    onSelectionChange ? `${SELECT_COLUMN_WIDTH}px` : null,
    ...columns.map((column) => `${widths[column.id]}px`),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex h-full flex-col" role="grid" aria-label={view.name} aria-rowcount={total}>
      <div className="flex-1 overflow-auto" ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <div style={{ minWidth: "max-content" }}>
          <div
            role="row"
            className="sticky top-0 z-20 grid h-row items-center border-b border-edge bg-surface-sunken"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {onSelectionChange ? (
              <div className="sticky left-0 z-10 flex h-row items-center justify-center bg-surface-sunken">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  className="h-4 w-4 accent-[var(--accent)]"
                  checked={records.length > 0 && selected.size === records.length}
                  onChange={(event) =>
                    onSelectionChange(event.target.checked ? records.map((record) => record.id) : [])
                  }
                />
              </div>
            ) : null}

            {columns.map((column, index) => (
              <HeaderCell
                key={column.id}
                field={column}
                sort={view.sort}
                sticky={index === 0}
                width={widths[column.id]!}
                onSortChange={onSortChange}
                onWidthChange={onColumnWidthChange}
              />
            ))}
          </div>

          {status === "loading" ? (
            <SkeletonRows rows={14} columns={Math.max(columns.length, 3)} />
          ) : records.length === 0 ? (
            <EmptyState
              title={emptyTitle ?? `No ${view.name.toLowerCase()} yet.`}
              className="py-6"
              actions={
                <>
                  {onCreate ? <ActionButton onClick={onCreate}>Add one</ActionButton> : null}
                  {onImport ? <ActionButton onClick={onImport}>Import from a spreadsheet</ActionButton> : null}
                </>
              }
            />
          ) : (
            <>
              {virtualise ? <div style={{ height: first * rowHeight }} aria-hidden /> : null}

              {visible.map((record, offset) => {
                const index = first + offset;
                const isSelected = selected.has(record.id);
                return (
                  <div
                    key={record.id}
                    role="row"
                    aria-rowindex={index + 1}
                    aria-selected={isSelected}
                    className={cn(
                      "grid h-row items-center border-b border-edge",
                      isSelected ? "bg-surface-hover" : "hover:bg-surface-hover",
                    )}
                    style={{ gridTemplateColumns: gridTemplate }}
                  >
                    {onSelectionChange ? (
                      <div
                        className={cn(
                          "sticky left-0 z-10 flex h-row items-center justify-center",
                          isSelected ? "bg-surface-hover" : "bg-surface",
                        )}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select row ${index + 1}`}
                          className="h-4 w-4 accent-[var(--accent)]"
                          checked={isSelected}
                          onChange={() => undefined}
                          onClick={(event) => toggleRow(record.id, index, event.shiftKey)}
                        />
                      </div>
                    ) : null}

                    {columns.map((column, columnIndex) => {
                      const isEditing = editing?.recordId === record.id && editing.fieldId === column.id;
                      return (
                        <div
                          key={column.id}
                          role="gridcell"
                          tabIndex={0}
                          className={cn(
                            "flex h-row items-center overflow-hidden truncate px-3 text-sm",
                            isNumericField(column) && "justify-end tabular-nums",
                            columnIndex === 0 &&
                              cn("sticky left-0 z-10", isSelected ? "bg-surface-hover" : "bg-surface"),
                          )}
                          style={columnIndex === 0 && onSelectionChange ? { left: SELECT_COLUMN_WIDTH } : undefined}
                          onDoubleClick={() => startEditing(record.id, column, record.data[column.id])}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !isEditing) {
                              event.preventDefault();
                              startEditing(record.id, column, record.data[column.id]);
                            }
                          }}
                        >
                          {isEditing ? (
                            <FieldRenderer
                              field={column}
                              value={draft}
                              mode="edit"
                              autoFocus
                              lookup={lookup}
                              onChange={setDraft}
                              onCommit={(value) => commitEdit(record.id, column.id, value)}
                              onCancel={() => setEditing(null)}
                              className="h-[calc(var(--row-h)-6px)]"
                            />
                          ) : columnIndex === 0 && onOpenRecord ? (
                            <button
                              type="button"
                              className="truncate text-left hover:underline"
                              onClick={() => onOpenRecord(record.id)}
                            >
                              <FieldRenderer
                                field={column}
                                value={record.data[column.id]}
                                mode="read"
                                lookup={lookup}
                                linkable={false}
                              />
                            </button>
                          ) : (
                            <FieldRenderer
                              field={column}
                              value={record.data[column.id]}
                              mode="read"
                              lookup={lookup}
                              linkable={false}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {virtualise ? (
                <div style={{ height: Math.max(0, (records.length - last) * rowHeight) }} aria-hidden />
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="flex h-row shrink-0 items-center justify-between border-t border-edge px-4 text-xs text-content-secondary">
        <span>
          {records.length === total
            ? `${total} ${total === 1 ? "record" : "records"}`
            : `${records.length} of ${total} records`}
        </span>
        {selected.size > 0 ? <span>{selected.size} selected</span> : null}
      </div>
    </div>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-control rounded border border-edge px-3 text-sm hover:bg-surface-hover"
    >
      {children}
    </button>
  );
}

function HeaderCell({
  field,
  sort,
  sticky,
  width,
  onSortChange,
  onWidthChange,
}: {
  field: FieldConfig;
  sort?: Sort;
  sticky: boolean;
  width: number;
  onSortChange?: (sort: Sort) => void;
  onWidthChange?: (fieldId: string, width: number) => void;
}) {
  const active = sort?.fieldId === field.id;

  const startResize = (event: React.PointerEvent) => {
    if (!onWidthChange) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = width;

    const move = (moveEvent: PointerEvent) => {
      const next = Math.max(60, startWidth + moveEvent.clientX - startX);
      onWidthChange(field.id, next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort?.direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "group relative flex h-row items-center gap-1.5 px-3 text-sm font-medium text-content-secondary",
        isNumericField(field) && "justify-end",
        sticky && "sticky left-0 z-10 bg-surface-sunken",
      )}
    >
      <button
        type="button"
        className="truncate hover:text-content"
        onClick={() =>
          onSortChange?.({
            fieldId: field.id,
            direction: active && sort?.direction === "asc" ? "desc" : "asc",
          })
        }
      >
        {field.label}
      </button>
      {active ? (
        sort?.direction === "asc" ? (
          <ArrowUp size={14} aria-hidden />
        ) : (
          <ArrowDown size={14} aria-hidden />
        )
      ) : null}

      {onWidthChange ? (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${field.label}`}
          onPointerDown={startResize}
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-[var(--border-strong)]"
        />
      ) : null}
    </div>
  );
}
