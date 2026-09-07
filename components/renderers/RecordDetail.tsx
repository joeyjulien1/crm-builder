"use client";

import * as React from "react";
import { X } from "lucide-react";
import type { CrmRecord, FieldConfig, ObjectConfig } from "@/lib/config/types";
import { formatValue } from "@/lib/runtime/field";
import { resolveLayout } from "@/lib/runtime/view";
import { FieldRenderer, type FieldLookup } from "./FieldRenderer";
import { ErrorState, SkeletonRows } from "./states";
import { cn } from "@/lib/utils";

/**
 * Side panel by default, full page on deep link. Everything is inline
 * editable, saving on blur with an optimistic update and a rollback if the
 * save fails — so a dropped connection never silently loses a keystroke.
 */

export interface TimelineEntry {
  id: string;
  kind: string;
  actor: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface RelatedGroup {
  label: string;
  records: { id: string; title: string }[];
}

export interface RecordDetailProps {
  record: CrmRecord;
  object: ObjectConfig;
  timeline?: TimelineEntry[];
  related?: RelatedGroup[];
  status?: "loading" | "error" | "ready";
  error?: string;
  onRetry?: () => void;
  onSave?: (fieldId: string, value: unknown) => Promise<void>;
  onClose?: () => void;
  onOpenRecord?: (recordId: string) => void;
  lookup?: FieldLookup;
  variant?: "panel" | "page";
}

export function RecordDetail({
  record,
  object,
  timeline = [],
  related = [],
  status = "ready",
  error,
  onRetry,
  onSave,
  onClose,
  onOpenRecord,
  lookup,
  variant = "panel",
}: RecordDetailProps) {
  const [values, setValues] = React.useState<Record<string, unknown>>(record.data);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValues(record.data);
  }, [record.id, record.data]);

  const groups = React.useMemo(() => resolveLayout(object), [object]);
  const titleField = object.fields.find((field) => field.id === object.titleFieldId) ?? object.fields[0];
  const title = titleField ? formatValue(titleField, values[titleField.id], lookup) : "Untitled";

  const save = async (field: FieldConfig, value: unknown) => {
    if (!onSave) return;
    const previous = values[field.id];
    if (JSON.stringify(previous) === JSON.stringify(value)) return;

    setValues((current) => ({ ...current, [field.id]: value }));
    setSaveError(null);

    try {
      await onSave(field.id, value);
    } catch (caught) {
      // Optimistic update rolled back — the field goes back to what was stored.
      setValues((current) => ({ ...current, [field.id]: previous }));
      setSaveError(caught instanceof Error ? caught.message : `${field.label} could not be saved.`);
    }
  };

  if (status === "error") {
    return <ErrorState message={error ?? "This record could not load."} onRetry={onRetry} className="h-full" />;
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-surface",
        variant === "panel" ? "w-[420px] border-l border-edge" : "w-full",
      )}
      aria-label={`${object.label} detail`}
    >
      <header className="flex h-row shrink-0 items-center justify-between gap-3 border-b border-edge px-4">
        <h2 className="truncate text-base font-semibold">{title || "Untitled"}</h2>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-content-secondary hover:text-content p-1 rounded hover:bg-surface-hover"
          >
            <X size={16} aria-hidden />
          </button>
        ) : null}
      </header>

      {saveError ? (
        <p role="alert" className="border-b border-edge px-4 py-2 text-xs text-[var(--danger)]">
          {saveError}
        </p>
      ) : null}

      <div className={cn("flex flex-1 overflow-hidden", variant === "page" && "gap-6")}>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {status === "loading" ? (
            <SkeletonRows rows={8} columns={2} />
          ) : (
            groups.map((group) => (
              <section key={group.label} className="mb-6">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {group.label}
                </h3>
                <dl className="flex flex-col gap-3.5">
                  {group.fields.map((field) => (
                    <div key={field.id} className="grid grid-cols-[130px_1fr] items-start gap-3">
                      <dt className="pt-1.5 text-sm text-content-secondary">{field.label}</dt>
                      <dd>
                        {onSave ? (
                          <FieldRenderer
                            field={field}
                            value={values[field.id] ?? null}
                            mode="edit"
                            lookup={lookup}
                            onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
                            onCommit={(value) => void save(field, value)}
                          />
                        ) : (
                          <FieldRenderer field={field} value={values[field.id]} mode="read" lookup={lookup} />
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))
          )}

          {related.length > 0 ? (
            <section className="mb-6">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-content-muted">Related</h3>
              {related.map((group) => (
                <div key={group.label} className="mb-4">
                  <p className="mb-2 text-xs text-content-secondary">{group.label}</p>
                  {group.records.length === 0 ? (
                    <p className="text-xs text-content-muted">Nothing linked yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {group.records.map((related) => (
                        <li key={related.id}>
                          <button
                            type="button"
                            onClick={() => onOpenRecord?.(related.id)}
                            className="text-sm hover:underline"
                          >
                            {related.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </section>
          ) : null}
        </div>

        <aside
          className={cn(
            "w-[240px] shrink-0 overflow-y-auto border-l border-edge px-4 py-4",
            variant === "panel" && "hidden",
          )}
          aria-label="Activity"
        >
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-content-muted">Activity</h3>
          {timeline.length === 0 ? (
            <p className="text-xs text-content-muted">Nothing has happened here yet.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {timeline.map((entry) => (
                <li key={entry.id} className="text-xs">
                  <p className="text-content">{describeEntry(entry, object)}</p>
                  <p className="text-content-muted">
                    {new Date(entry.createdAt).toLocaleString()} · {entry.actor}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}

function describeEntry(entry: TimelineEntry, object: ObjectConfig): string {
  switch (entry.kind) {
    case "created":
      return `${object.label} created`;
    case "field_change": {
      const field = object.fields.find((f) => f.id === entry.detail.fieldId);
      if (!field) return "A field changed";
      const to = formatValue(field, entry.detail.to);
      return to ? `${field.label} set to ${to}` : `${field.label} cleared`;
    }
    case "automation":
      return `Automation "${String(entry.detail.name ?? "")}" ran`;
    case "email":
      return `Email: ${String(entry.detail.subject ?? "(no subject)")}`;
    case "note":
      return String(entry.detail.body ?? "Note added");
    default:
      return entry.kind;
  }
}
