"use client";

import * as React from "react";
import { Check, ExternalLink, Minus } from "lucide-react";
import type { FieldConfig } from "@/lib/config/types";
import { formatValue, inputKindFor } from "@/lib/runtime/field";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * One component, a switch over the fourteen field types, two modes. Every other
 * renderer delegates here — that is what keeps a currency field formatted
 * identically in a table cell, a card, a detail panel, and a form.
 *
 * Adding a field type means adding one case here and one filter predicate. If
 * it means touching four components, the abstraction has leaked.
 */

export interface FieldLookup {
  /** Resolves a relation or user id to a name. */
  labelFor?: (id: string) => string | undefined;
  /** Candidate records or people for a relation or user field. */
  optionsFor?: (field: FieldConfig) => { value: string; label: string }[];
}

export interface FieldRendererProps {
  field: FieldConfig;
  value: unknown;
  mode: "read" | "edit";
  onChange?: (value: unknown) => void;
  /** Fired on blur or on Enter — where a detail panel saves. */
  onCommit?: (value: unknown) => void;
  onCancel?: () => void;
  lookup?: FieldLookup;
  autoFocus?: boolean;
  invalid?: boolean;
  inputId?: string;
  describedBy?: string;
  className?: string;
  /**
   * Off inside a table, where a cell is a double-click away from being edited
   * and a stray click should not open a mail client.
   */
  linkable?: boolean;
}

export function FieldRenderer({
  field,
  value,
  mode,
  onChange,
  onCommit,
  onCancel,
  lookup,
  autoFocus,
  invalid,
  inputId,
  describedBy,
  className,
  linkable = true,
}: FieldRendererProps) {
  if (mode === "read") {
    return <ReadValue field={field} value={value} lookup={lookup} className={className} linkable={linkable} />;
  }
  return (
    <EditValue
      field={field}
      value={value}
      onChange={onChange}
      onCommit={onCommit}
      onCancel={onCancel}
      lookup={lookup}
      autoFocus={autoFocus}
      invalid={invalid}
      inputId={inputId}
      describedBy={describedBy}
      className={className}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Read                                                                        */
/* -------------------------------------------------------------------------- */

function ReadValue({
  field,
  value,
  lookup,
  className,
  linkable = true,
}: Pick<FieldRendererProps, "field" | "value" | "lookup" | "className" | "linkable">) {
  const empty = value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);

  if (empty) {
    return <span className={cn("text-content-muted", className)} aria-label="No value">—</span>;
  }

  switch (field.type) {
    case "boolean":
      return (
        <span className={cn("inline-flex items-center gap-1 text-sm", className)}>
          {value ? <Check size={14} aria-hidden /> : <Minus size={14} aria-hidden />}
          {value ? "Yes" : "No"}
        </span>
      );

    case "select":
      return <Badge className={className}>{formatValue(field, value, lookup)}</Badge>;

    case "multi_select": {
      const values = Array.isArray(value) ? value : [value];
      return (
        <span className={cn("flex flex-wrap gap-1", className)}>
          {values.map((entry) => (
            <Badge key={String(entry)}>
              {field.options?.find((option) => option.value === entry)?.label ?? String(entry)}
            </Badge>
          ))}
        </span>
      );
    }

    case "url":
      return linkable ? (
        <a
          href={String(value)}
          target="_blank"
          rel="noreferrer noopener"
          className={cn("inline-flex items-center gap-1 underline underline-offset-2", className)}
        >
          {String(value).replace(/^https?:\/\//, "")}
          <ExternalLink size={11} aria-hidden />
        </a>
      ) : (
        <span className={className}>{String(value).replace(/^https?:\/\//, "")}</span>
      );

    case "email":
      return linkable ? (
        <a href={`mailto:${String(value)}`} className={cn("underline underline-offset-2", className)}>
          {String(value)}
        </a>
      ) : (
        <span className={className}>{String(value)}</span>
      );

    case "phone":
      return linkable ? (
        <a href={`tel:${String(value)}`} className={cn("underline underline-offset-2", className)}>
          {String(value)}
        </a>
      ) : (
        <span className={className}>{String(value)}</span>
      );

    case "number":
    case "currency":
      return (
        <span className={cn("tabular-nums", className)}>{formatValue(field, value, lookup)}</span>
      );

    case "long_text":
      return <span className={cn("whitespace-pre-wrap", className)}>{String(value)}</span>;

    default:
      return <span className={className}>{formatValue(field, value, lookup)}</span>;
  }
}

/* -------------------------------------------------------------------------- */
/* Edit                                                                        */
/* -------------------------------------------------------------------------- */

function EditValue({
  field,
  value,
  onChange,
  onCommit,
  onCancel,
  lookup,
  autoFocus,
  invalid,
  inputId,
  describedBy,
  className,
}: Omit<FieldRendererProps, "mode">) {
  const kind = inputKindFor(field);

  const commit = (next: unknown) => {
    onChange?.(next);
    onCommit?.(next);
  };

  const keyHandler = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && kind !== "textarea") {
      event.preventDefault();
      onCommit?.((event.target as HTMLInputElement).value);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel?.();
    }
  };

  const shared = {
    id: inputId,
    "aria-describedby": describedBy,
    autoFocus,
    "aria-invalid": invalid ? true : undefined,
    "aria-label": field.label,
    className,
    onKeyDown: keyHandler,
  } as const;

  switch (kind) {
    case "textarea":
      return (
        <Textarea
          {...shared}
          rows={4}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(event) => onChange?.(event.target.value)}
          onBlur={(event) => onCommit?.(event.target.value)}
        />
      );

    case "checkbox":
      return (
        <input
          {...shared}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => commit(event.target.checked)}
          className={cn("h-4 w-4 accent-[var(--accent)]", className)}
        />
      );

    case "select": {
      const options = field.options ?? [];
      return (
        <Select
          {...shared}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(event) => commit(event.target.value || null)}
        >
          <option value="">—</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    }

    case "multi_select": {
      const selected = new Set((Array.isArray(value) ? value : []).map(String));
      return (
        <div id={inputId} tabIndex={-1} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={cn("flex flex-wrap gap-2", className)} role="group" aria-label={field.label}>
          {(field.options ?? []).map((option) => {
            const checked = selected.has(option.value);
            return (
              <label
                key={option.value}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1 rounded-sm border px-2 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus-ring)] text-xs leading-5",
                  checked ? "border-[var(--accent)] text-content" : "border-edge text-content-secondary",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => {
                    const next = new Set(selected);
                    if (checked) next.delete(option.value);
                    else next.add(option.value);
                    commit([...next]);
                  }}
                />
                {checked ? <Check size={11} aria-hidden /> : null}
                {option.label}
              </label>
            );
          })}
        </div>
      );
    }

    case "relation":
    case "user": {
      const options = lookup?.optionsFor?.(field) ?? [];
      return (
        <Select
          {...shared}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(event) => commit(event.target.value || null)}
        >
          <option value="">—</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    }

    case "number":
    case "currency":
      return (
        <Input
          {...shared}
          type="number"
          inputMode="decimal"
          step={field.type === "currency" ? "0.01" : "any"}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(event) => onChange?.(event.target.value)}
          onBlur={(event) => onCommit?.(event.target.value)}
        />
      );

    case "date":
    case "datetime":
      return (
        <Input
          {...shared}
          type={kind === "date" ? "date" : "datetime-local"}
          value={toInputDate(value, kind)}
          onChange={(event) => onChange?.(event.target.value)}
          onBlur={(event) => onCommit?.(event.target.value)}
        />
      );

    default:
      return (
        <Input
          {...shared}
          type={kind === "email" ? "email" : kind === "url" ? "url" : kind === "phone" ? "tel" : "text"}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(event) => onChange?.(event.target.value)}
          onBlur={(event) => onCommit?.(event.target.value)}
        />
      );
  }
}

function toInputDate(value: unknown, kind: "date" | "datetime"): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return kind === "date" ? date.toISOString().slice(0, 10) : date.toISOString().slice(0, 16);
}
