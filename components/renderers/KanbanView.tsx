"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CrmRecord, FieldConfig, PipelineConfig, ViewConfig } from "@/lib/config/types";
import { formatValue } from "@/lib/runtime/field";
import { FieldRenderer, type FieldLookup } from "./FieldRenderer";
import { EmptyState, ErrorState } from "./states";
import { cn } from "@/lib/utils";

/**
 * Columns come from the pipeline's stages. Dragging a card between columns
 * writes the stage field, which is what fires the field_changed trigger — the
 * board does not have a private notion of "moved".
 */

const PAGE_SIZE = 50;

export interface KanbanViewProps {
  view: ViewConfig;
  pipeline: PipelineConfig;
  stageField: FieldConfig;
  cardFields: FieldConfig[];
  sumField?: FieldConfig;
  records: CrmRecord[];
  status?: "loading" | "error" | "ready";
  error?: string;
  onRetry?: () => void;
  onStageChange?: (recordId: string, stageKey: string) => void;
  onOpenRecord?: (recordId: string) => void;
  onCreate?: (stageKey: string) => void;
  lookup?: FieldLookup;
}

export function KanbanView({
  view,
  pipeline,
  stageField,
  cardFields,
  sumField,
  records,
  status = "ready",
  error,
  onRetry,
  onStageChange,
  onOpenRecord,
  onCreate,
  lookup,
}: KanbanViewProps) {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [shown, setShown] = React.useState<Record<string, number>>({});
  const [dragOver, setDragOver] = React.useState<string | null>(null);

  const byStage = React.useMemo(() => {
    const grouped = new Map<string, CrmRecord[]>();
    for (const stage of pipeline.stages) grouped.set(stage.key, []);
    for (const record of records) {
      const stageKey = String(record.data[stageField.id] ?? "");
      grouped.get(stageKey)?.push(record);
    }
    return grouped;
  }, [records, pipeline.stages, stageField.id]);

  if (status === "error") {
    return <ErrorState message={error ?? "This board could not load."} onRetry={onRetry} className="h-full" />;
  }

  return (
    <div className="flex h-full gap-4 overflow-x-auto p-4" role="list" aria-label={view.name}>
      {pipeline.stages.map((stage) => {
        const stageRecords = byStage.get(stage.key) ?? [];
        const limit = shown[stage.key] ?? PAGE_SIZE;
        const visible = stageRecords.slice(0, limit);
        const isCollapsed = collapsed[stage.key];

        const sum = sumField
          ? stageRecords.reduce((total, record) => {
              const value = Number(record.data[sumField.id]);
              return Number.isFinite(value) ? total + value : total;
            }, 0)
          : null;

        return (
          <section
            key={stage.key}
            role="listitem"
            aria-label={stage.label}
            onDragOver={(event) => {
              if (!onStageChange) return;
              event.preventDefault();
              setDragOver(stage.key);
            }}
            onDragLeave={() => setDragOver((current) => (current === stage.key ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(null);
              const recordId = event.dataTransfer.getData("text/record-id");
              if (recordId) onStageChange?.(recordId, stage.key);
            }}
            className={cn(
              "flex shrink-0 flex-col rounded border border-edge bg-surface-sunken transition-colors duration-fast",
              isCollapsed ? "w-14" : "w-80",
              dragOver === stage.key && "border-[var(--accent)]",
            )}
          >
            <header className="flex h-row items-center justify-between gap-2 border-b border-edge px-3.5">
              {isCollapsed ? (
                <button
                  type="button"
                  aria-label={`Expand ${stage.label}`}
                  onClick={() => setCollapsed((c) => ({ ...c, [stage.key]: false }))}
                  className="text-content-secondary hover:text-content"
                >
                  <ChevronRight size={16} aria-hidden />
                </button>
              ) : (
                <>
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-sm font-semibold">{stage.label}</span>
                    <span className="text-sm text-content-muted tabular-nums">{stageRecords.length}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {sum !== null && sumField ? (
                      <span className="text-sm text-content-secondary tabular-nums">
                        {formatValue(sumField, sum)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Collapse ${stage.label}`}
                      onClick={() => setCollapsed((c) => ({ ...c, [stage.key]: true }))}
                      className="text-content-secondary hover:text-content"
                    >
                      <ChevronLeft size={16} aria-hidden />
                    </button>
                  </div>
                </>
              )}
            </header>

            {isCollapsed ? null : (
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                {status === "loading" ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="skeleton h-16 w-full" />
                  ))
                ) : stageRecords.length === 0 ? (
                  <EmptyState
                    title={`Nothing in ${stage.label.toLowerCase()}.`}
                    actions={
                      onCreate ? (
                        <button
                          type="button"
                          onClick={() => onCreate(stage.key)}
                          className="text-sm underline underline-offset-2"
                        >
                          Add one here
                        </button>
                      ) : null
                    }
                  />
                ) : (
                  <>
                    {visible.map((record) => (
                      <article
                        key={record.id}
                        draggable={Boolean(onStageChange)}
                        onDragStart={(event) => event.dataTransfer.setData("text/record-id", record.id)}
                        className="cursor-grab rounded border border-edge bg-surface p-3.5 active:cursor-grabbing shadow-sm"
                      >
                        <button
                          type="button"
                          onClick={() => onOpenRecord?.(record.id)}
                          className="flex w-full flex-col gap-1.5 text-left"
                        >
                          {cardFields.map((field, index) => (
                            <div
                              key={field.id}
                              className={cn(
                                "truncate",
                                index === 0 ? "text-base font-semibold" : "text-sm text-content-secondary",
                              )}
                            >
                              <FieldRenderer field={field} value={record.data[field.id]} mode="read" lookup={lookup} />
                            </div>
                          ))}
                        </button>
                      </article>
                    ))}

                    {stageRecords.length > visible.length ? (
                      <button
                        type="button"
                        onClick={() => setShown((s) => ({ ...s, [stage.key]: limit + PAGE_SIZE }))}
                        className="h-control rounded border border-edge text-sm text-content-secondary hover:bg-surface-hover"
                      >
                        Show {Math.min(PAGE_SIZE, stageRecords.length - visible.length)} more
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
