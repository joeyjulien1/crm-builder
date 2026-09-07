"use client";

import * as React from "react";
import * as icons from "lucide-react";
import { Button as UiButton } from "@/components/ui/button";
import { Badge as UiBadge } from "@/components/ui/badge";
import { Input as UiInput } from "@/components/ui/input";
import { FieldRenderer } from "@/components/renderers/FieldRenderer";
import { formatValue } from "@/lib/runtime/field";
import { cn } from "@/lib/utils";
import type { CrmRecord, FieldConfig, ObjectConfig } from "@/lib/config/types";

/**
 * The kit a coded screen builds from.
 *
 * Two jobs. The obvious one is to make a good-looking screen easy to write, so
 * the model reaches for `<Card>` rather than inventing a div with eleven
 * classes. The less obvious one is that **Tailwind cannot see generated code**:
 * it scans source files at build time, and a screen lives in the database, so a
 * class the model invents has no CSS behind it. Classes used here are compiled;
 * a curated set of layout utilities is safelisted in `tailwind.config.ts`
 * alongside. Anything outside both silently does nothing, which is why the kit
 * carries the styling rather than the screen.
 *
 * Everything resolves to the tenant's theme tokens — the same variables the
 * config-driven renderers use — so a coded screen inherits the customer's
 * palette, type and density instead of fighting it.
 */

type Div = React.HTMLAttributes<HTMLDivElement>;

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export function Page({ className, ...props }: Div) {
  return <div className={cn("flex min-h-0 w-full flex-col gap-5 p-5", className)} {...props} />;
}

export function Section({
  title,
  action,
  className,
  children,
  ...props
}: Div & { title?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)} {...props}>
      {(title || action) && (
        <div className="flex items-baseline justify-between gap-3">
          {typeof title === "string" ? <Heading level={2}>{title}</Heading> : title}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Row({ className, ...props }: Div) {
  return <div className={cn("flex min-w-0 flex-wrap items-center gap-3", className)} {...props} />;
}

export function Col({ className, ...props }: Div) {
  return <div className={cn("flex min-w-0 flex-col gap-3", className)} {...props} />;
}

export function Grid({ cols = 3, className, ...props }: Div & { cols?: number }) {
  const columns: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
    5: "grid-cols-2 lg:grid-cols-5",
    6: "grid-cols-3 lg:grid-cols-6",
  };
  return <div className={cn("grid min-w-0 gap-3", columns[cols] ?? columns[3], className)} {...props} />;
}

export function Card({ className, ...props }: Div) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-2 rounded border border-edge bg-surface-raised p-4", className)}
      {...props}
    />
  );
}

export function Panel({ className, ...props }: Div) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3 rounded bg-surface-sunken p-4", className)} {...props} />
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-edge", className)} />;
}

/* -------------------------------------------------------------------------- */
/* Words                                                                       */
/* -------------------------------------------------------------------------- */

export function Heading({
  level = 2,
  className,
  children,
}: {
  level?: 1 | 2 | 3;
  className?: string;
  children: React.ReactNode;
}) {
  const Tag = (["h1", "h2", "h3"] as const)[level - 1] ?? "h2";
  const size = { 1: "text-2xl", 2: "text-lg", 3: "text-base" }[level];
  return <Tag className={cn("font-display font-semibold text-content", size, className)}>{children}</Tag>;
}

export function Text({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-content-secondary", className)} {...props} />;
}

export function Muted({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-xs text-content-muted", className)} {...props} />;
}

/** A number worth looking at. `delta` is coloured by its sign, not by a prop. */
export function Stat({
  label,
  value,
  delta,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: string;
  className?: string;
}) {
  const direction = delta?.trim().startsWith("-") ? "text-danger" : "text-success";
  return (
    <Card className={cn("gap-1", className)}>
      <span className="text-xs text-content-muted">{label}</span>
      <span className="font-display text-2xl font-semibold text-content">{value}</span>
      {delta && <span className={cn("text-xs", direction)}>{delta}</span>}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

export const Button = UiButton;
export const Badge = UiBadge;
export const Input = UiInput;

export function Select({
  value,
  onChange,
  options,
  className,
  placeholder,
}: {
  value?: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  placeholder?: string;
}) {
  return (
    <select
      className={cn(
        "h-control rounded border border-edge bg-surface px-3 text-sm text-content",
        className,
      )}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** A lucide icon by name. Unknown names draw nothing rather than crashing. */
export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Found = (icons as unknown as Record<string, React.ComponentType<{ size?: number; className?: string }>>)[name];
  if (!Found) return null;
  return <Found size={size} className={className} />;
}

/* -------------------------------------------------------------------------- */
/* States — every screen needs all four, so none of them is optional here      */
/* -------------------------------------------------------------------------- */

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-2 p-1" aria-busy="true" aria-live="polite">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-row animate-pulse rounded bg-surface-hover" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded border border-edge bg-surface-sunken p-8 text-center">
      <p className="text-sm text-content">{title}</p>
      {children && <p className="max-w-sm text-xs text-content-secondary">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded border border-danger bg-surface-raised p-3 text-sm text-danger">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Records                                                                     */
/* -------------------------------------------------------------------------- */

/** One field's value, formatted the way it is formatted everywhere else. */
export function Value({
  object,
  fieldKey,
  record,
  titles,
}: {
  object?: ObjectConfig;
  fieldKey: string;
  record: CrmRecord;
  titles?: Record<string, string>;
}) {
  const field = object?.fields.find((candidate) => candidate.key === fieldKey || candidate.id === fieldKey);
  if (!field) return null;
  return (
    <FieldRenderer
      field={field}
      value={record.data[field.id]}
      mode="read"
      lookup={{ labelFor: (id: string) => titles?.[id] }}
    />
  );
}

/**
 * The workhorse. Columns are field keys — the names a person sees in the
 * editor — so a coded screen reads `["name", "amount", "stage"]` rather than
 * carrying field ids around.
 */
export function DataTable({
  object,
  records,
  columns,
  titles,
  onRowClick,
  empty,
  className,
}: {
  object?: ObjectConfig;
  records: CrmRecord[];
  columns: string[];
  titles?: Record<string, string>;
  onRowClick?: (record: CrmRecord) => void;
  empty?: React.ReactNode;
  className?: string;
}) {
  const fields = columns
    .map((key) => object?.fields.find((field) => field.key === key || field.id === key))
    .filter((field): field is FieldConfig => Boolean(field));

  if (records.length === 0) {
    return <>{empty ?? <EmptyState title={`No ${object?.labelPlural.toLowerCase() ?? "records"} yet.`} />}</>;
  }

  return (
    <div className={cn("min-w-0 overflow-x-auto rounded border border-edge", className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-edge bg-surface-sunken text-left">
            {fields.map((field) => (
              <th key={field.id} className="px-3 py-2 text-xs font-medium text-content-secondary">
                {field.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              key={record.id}
              onClick={onRowClick ? () => onRowClick(record) : undefined}
              className={cn(
                "h-row border-b border-edge last:border-b-0",
                onRowClick && "cursor-pointer hover:bg-surface-hover",
              )}
            >
              {fields.map((field) => (
                <td key={field.id} className="px-3 py-1.5 align-middle text-content">
                  <FieldRenderer
                    field={field}
                    value={record.data[field.id]}
                    mode="read"
                    lookup={{ labelFor: (id: string) => titles?.[id] }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Groups records by a choice field — the shape of every board ever drawn. */
export function GroupedBy({
  object,
  records,
  fieldKey,
  render,
}: {
  object?: ObjectConfig;
  records: CrmRecord[];
  fieldKey: string;
  render: (group: { key: string; label: string; records: CrmRecord[] }) => React.ReactNode;
}) {
  const field = object?.fields.find((candidate) => candidate.key === fieldKey || candidate.id === fieldKey);
  if (!field) return null;

  const options = field.options ?? [];
  const groups = options.map((option) => ({
    key: option.value,
    label: option.label,
    records: records.filter((record) => record.data[field.id] === option.value),
  }));

  return <>{groups.map((group) => <React.Fragment key={group.key}>{render(group)}</React.Fragment>)}</>;
}

/** Sums a numeric field over records, formatted as that field formats. */
export function sumOf(object: ObjectConfig | undefined, records: CrmRecord[], fieldKey: string): string {
  const field = object?.fields.find((candidate) => candidate.key === fieldKey || candidate.id === fieldKey);
  if (!field) return "";
  const total = records.reduce((running, record) => {
    const value = Number(record.data[field.id]);
    return Number.isFinite(value) ? running + value : running;
  }, 0);
  return formatValue(field, total);
}
