"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import {
  operatorOptions,
  readAt,
  VALUELESS_OPERATORS,
  writeAt,
  type Control,
  type ControlOption,
  TRIGGER_OBJECT,
} from "@/lib/config/controls";
import { keyFrom } from "./ids";
import { cn } from "@/lib/utils";
import type { Config, FieldConfig, FilterCondition, FilterTree, ObjectKey } from "@/lib/config/types";

/**
 * The inputs the inspector draws, one per `Control` kind.
 *
 * Nothing here knows what it is editing. A control is handed a draft, a path
 * and a `commit`, so the same select renders a node's padding, a workflow
 * step's delay unit and a field's requiredness. That is what keeps the editor
 * from growing a panel per thing — see lib/config/controls.ts.
 *
 * Two behaviours are deliberate and load-bearing:
 *
 * - **Discrete controls commit immediately; typed ones commit on blur.** A
 *   select has a moment where the user is done. A text input does not, and
 *   committing per keystroke would mint a config version per character.
 * - **A cleared value is deleted, not blanked.** `writeAt(..., undefined)`
 *   removes the key, so an unset style prop is absent from the JSON rather than
 *   sitting there as null for the validator to reject.
 */

export interface ControlContext {
  config: Config;
  /** The object a workflow's steps operate on, for `$trigger` sources. */
  triggerObjectKey?: string;
}

interface ControlProps {
  control: Control;
  draft: unknown;
  context: ControlContext;
  disabled?: boolean;
  /** Hands back the whole draft with this control's path written. */
  commit: (next: unknown) => void;
}

const labelClass = "text-[11px] font-medium text-zinc-400";
const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-[#131316] px-2.5 py-1.5 text-xs text-zinc-100 transition-colors placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none disabled:opacity-50";
const selectClass = cn(inputClass, "appearance-none pr-6");

/* -------------------------------------------------------------------------- */
/* Resolving what a control needs from config                                  */
/* -------------------------------------------------------------------------- */

function objectKeyFor(source: string, draft: unknown, context: ControlContext): string | undefined {
  if (source === TRIGGER_OBJECT) return context.triggerObjectKey;
  const value = readAt(draft, source);
  return typeof value === "string" ? value : undefined;
}

function fieldsFor(
  source: string,
  draft: unknown,
  context: ControlContext,
  types?: readonly string[],
): FieldConfig[] {
  const objectKey = objectKeyFor(source, draft, context);
  const object = context.config.objects.find((candidate) => candidate.key === objectKey);
  if (!object) return [];
  return types ? object.fields.filter((field) => types.includes(field.type)) : object.fields;
}

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

/** Text that commits when the user stops — on blur, or on Enter for one-liners. */
function TextInput({
  value,
  onCommit,
  multiline,
  rows,
  disabled,
  placeholder,
  maxLength,
}: {
  value: string;
  onCommit: (next: string) => void;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  if (multiline) {
    return (
      <textarea
        className={cn(inputClass, "resize-y font-sans leading-relaxed")}
        rows={rows ?? 3}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
      />
    );
  }

  return (
    <input
      className={inputClass}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") setDraft(value);
      }}
    />
  );
}

function Select({
  value,
  options,
  onCommit,
  clearable,
  disabled,
  placeholder = "Not set",
}: {
  value: string | undefined;
  options: ControlOption[];
  onCommit: (next: string | undefined) => void;
  clearable?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <select
      className={selectClass}
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onCommit(event.target.value === "" ? undefined : event.target.value)}
    >
      {(clearable || value === undefined) && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  value,
  onCommit,
  label,
  disabled,
}: {
  value: boolean;
  onCommit: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 rounded border-zinc-700 bg-[#131316] accent-zinc-300"
        checked={value}
        disabled={disabled}
        onChange={(event) => onCommit(event.target.checked)}
      />
      <span className="text-xs text-zinc-300">{label}</span>
    </label>
  );
}

const iconButton =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-800 text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-40";

/* -------------------------------------------------------------------------- */
/* Conditions — the shape filters, branches and workflow steps all share       */
/* -------------------------------------------------------------------------- */

function valueInputFor(
  field: FieldConfig | undefined,
  value: unknown,
  onCommit: (next: unknown) => void,
  disabled?: boolean,
) {
  if (!field) return <TextInput value={String(value ?? "")} onCommit={onCommit} disabled={disabled} />;

  if (field.type === "select" || field.type === "multi_select") {
    return (
      <Select
        value={value === undefined ? undefined : String(value)}
        options={(field.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
        onCommit={onCommit}
        clearable
        disabled={disabled}
      />
    );
  }

  if (field.type === "number" || field.type === "currency") {
    return (
      <input
        type="number"
        className={inputClass}
        defaultValue={value === undefined ? "" : String(value)}
        disabled={disabled}
        onBlur={(event) => onCommit(event.target.value === "" ? undefined : Number(event.target.value))}
      />
    );
  }

  if (field.type === "date" || field.type === "datetime") {
    return (
      <input
        type={field.type === "date" ? "date" : "datetime-local"}
        className={inputClass}
        defaultValue={value === undefined ? "" : String(value).slice(0, field.type === "date" ? 10 : 16)}
        disabled={disabled}
        onBlur={(event) => onCommit(event.target.value === "" ? undefined : event.target.value)}
      />
    );
  }

  return <TextInput value={String(value ?? "")} onCommit={onCommit} disabled={disabled} />;
}

export function ConditionRows({
  conditions,
  fields,
  onChange,
  disabled,
}: {
  conditions: FilterCondition[];
  fields: FieldConfig[];
  onChange: (next: FilterCondition[]) => void;
  disabled?: boolean;
}) {
  const fieldOptions = fields.map((field) => ({ value: field.id, label: field.label }));

  const update = (index: number, next: FilterCondition) => {
    onChange(conditions.map((condition, position) => (position === index ? next : condition)));
  };

  return (
    <div className="flex flex-col gap-2">
      {conditions.map((condition, index) => {
        const field = fields.find((candidate) => candidate.id === condition.fieldId);
        const takesValue = !VALUELESS_OPERATORS.has(condition.operator);
        return (
          <div key={index} className="flex flex-col gap-1.5 rounded-lg border border-zinc-800/80 p-2">
            <div className="flex items-center gap-1.5">
              <Select
                value={condition.fieldId}
                options={fieldOptions}
                onCommit={(fieldId) => {
                  const next = fields.find((candidate) => candidate.id === fieldId);
                  const allowed = operatorOptions(next?.type);
                  update(index, {
                    fieldId: fieldId ?? "",
                    // The old operator may not be legal on the new field type.
                    operator: allowed.some((option) => option.value === condition.operator)
                      ? condition.operator
                      : (allowed[0]?.value as FilterCondition["operator"]),
                    value: undefined,
                  });
                }}
                disabled={disabled}
                placeholder="Pick a field"
              />
              <button
                type="button"
                className={iconButton}
                disabled={disabled}
                title="Remove this condition"
                aria-label="Remove this condition"
                onClick={() => onChange(conditions.filter((_, position) => position !== index))}
              >
                <X size={12} />
              </button>
            </div>
            <Select
              value={condition.operator}
              options={operatorOptions(field?.type)}
              onCommit={(operator) =>
                update(index, {
                  ...condition,
                  operator: (operator ?? "is") as FilterCondition["operator"],
                  value: VALUELESS_OPERATORS.has(operator ?? "") ? undefined : condition.value,
                })
              }
              disabled={disabled}
            />
            {takesValue && valueInputFor(field, condition.value, (value) => update(index, { ...condition, value }), disabled)}
          </div>
        );
      })}

      <button
        type="button"
        className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-900/60 hover:text-zinc-200 disabled:opacity-40"
        disabled={disabled || fields.length === 0}
        onClick={() => {
          const field = fields[0];
          if (!field) return;
          onChange([
            ...conditions,
            {
              fieldId: field.id,
              operator: (operatorOptions(field.type)[0]?.value ?? "is") as FilterCondition["operator"],
              value: undefined,
            },
          ]);
        }}
      >
        <Plus size={12} />
        Add condition
      </button>
      {fields.length === 0 && (
        <p className="text-[11px] text-zinc-600">Pick which records this reads first.</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The dispatcher                                                              */
/* -------------------------------------------------------------------------- */

export function ControlInput({ control, draft, context, disabled, commit }: ControlProps) {
  const value = readAt(draft, control.key);
  const write = (next: unknown) => commit(writeAt(draft, control.key, next));

  switch (control.kind) {
    case "text":
      return (
        <TextInput
          value={typeof value === "string" ? value : ""}
          maxLength={control.max}
          placeholder={control.placeholder}
          disabled={disabled}
          onCommit={(next) => write(next === "" ? undefined : next)}
        />
      );

    case "textarea":
    case "merge-text":
      return (
        <TextInput
          multiline
          rows={control.rows}
          maxLength={control.max}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onCommit={(next) => write(next === "" ? undefined : next)}
        />
      );

    case "number":
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            className={inputClass}
            min={control.min}
            max={control.max}
            step={control.step}
            defaultValue={typeof value === "number" ? value : ""}
            disabled={disabled}
            key={String(value)}
            onBlur={(event) => write(event.target.value === "" ? undefined : Number(event.target.value))}
          />
          {control.unit && <span className="shrink-0 text-[11px] text-zinc-500">{control.unit}</span>}
        </div>
      );

    case "toggle":
      return <Toggle value={value === true} label={control.label} onCommit={write} disabled={disabled} />;

    case "select":
      return (
        <Select
          value={value === undefined || value === null ? undefined : String(value)}
          options={control.options}
          clearable={control.clearable}
          disabled={disabled}
          onCommit={(next) =>
            write(next !== undefined && control.numeric ? Number(next) : next)
          }
        />
      );

    case "object":
      return (
        <Select
          value={typeof value === "string" ? value : undefined}
          options={context.config.objects.map((object) => ({ value: object.key, label: object.labelPlural }))}
          disabled={disabled}
          onCommit={write}
        />
      );

    case "screen":
      return (
        <Select
          value={typeof value === "string" ? value : undefined}
          options={(context.config.screens ?? []).map((screen) => ({ value: screen.id, label: screen.name }))}
          disabled={disabled}
          onCommit={write}
        />
      );

    case "pipeline":
      return (
        <Select
          value={typeof value === "string" ? value : undefined}
          options={context.config.pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))}
          disabled={disabled}
          onCommit={write}
        />
      );

    case "field": {
      const fields = fieldsFor(control.objectFrom, draft, context, control.types);
      return (
        <Select
          value={typeof value === "string" ? value : undefined}
          options={fields.map((field) => ({ value: field.id, label: field.label }))}
          clearable={control.clearable}
          disabled={disabled}
          onCommit={write}
        />
      );
    }

    case "fields": {
      const fields = fieldsFor(control.objectFrom, draft, context);
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      if (fields.length === 0) {
        return <p className="text-[11px] text-zinc-600">Pick which records this reads first.</p>;
      }
      return (
        <div className="flex flex-col gap-0.5">
          {fields.map((field) => (
            <Toggle
              key={field.id}
              label={field.label}
              value={chosen.includes(field.id)}
              disabled={disabled}
              onCommit={(on) =>
                write(
                  on
                    ? [...chosen, field.id]
                    : chosen.filter((id) => id !== field.id),
                )
              }
            />
          ))}
        </div>
      );
    }

    case "filters": {
      const tree = (value as FilterTree | undefined) ?? { join: "and", conditions: [], groups: [] };
      const fields = fieldsFor(control.objectFrom, draft, context);
      return (
        <div className="flex flex-col gap-2">
          {tree.conditions.length > 1 && (
            <Select
              value={tree.join}
              options={[
                { value: "and", label: "Match all of these" },
                { value: "or", label: "Match any of these" },
              ]}
              disabled={disabled}
              onCommit={(join) => write({ ...tree, join: join ?? "and" })}
            />
          )}
          <ConditionRows
            conditions={tree.conditions}
            fields={fields}
            disabled={disabled}
            onChange={(conditions) =>
              write(conditions.length === 0 && tree.groups.length === 0 ? undefined : { ...tree, conditions })
            }
          />
        </div>
      );
    }

    case "conditions": {
      const conditions = Array.isArray(value) ? (value as FilterCondition[]) : [];
      return (
        <ConditionRows
          conditions={conditions}
          fields={fieldsFor(control.objectFrom, draft, context)}
          disabled={disabled}
          onChange={write}
        />
      );
    }

    case "sort": {
      const sort = value as { fieldId: string; direction: "asc" | "desc" } | undefined;
      const fields = fieldsFor(control.objectFrom, draft, context);
      return (
        <div className="flex gap-1.5">
          <Select
            value={sort?.fieldId}
            options={fields.map((field) => ({ value: field.id, label: field.label }))}
            clearable
            disabled={disabled}
            onCommit={(fieldId) =>
              write(fieldId ? { fieldId, direction: sort?.direction ?? "asc" } : undefined)
            }
          />
          <Select
            value={sort?.direction ?? "asc"}
            options={[
              { value: "asc", label: "Ascending" },
              { value: "desc", label: "Descending" },
            ]}
            disabled={disabled || !sort?.fieldId}
            onCommit={(direction) =>
              sort?.fieldId && write({ fieldId: sort.fieldId, direction: direction ?? "asc" })
            }
          />
        </div>
      );
    }

    case "options": {
      const list = Array.isArray(value) ? (value as { value: string; label: string }[]) : [];
      return (
        <div className="flex flex-col gap-1.5">
          {list.map((option, index) => (
            <div key={option.value} className="flex items-center gap-1.5">
              <TextInput
                value={option.label}
                disabled={disabled}
                onCommit={(label) =>
                  write(list.map((entry, position) => (position === index ? { ...entry, label } : entry)))
                }
              />
              <button
                type="button"
                className={iconButton}
                disabled={disabled}
                title={`Remove ${option.label}`}
                aria-label={`Remove ${option.label}`}
                onClick={() => write(list.filter((_, position) => position !== index))}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-900/60 hover:text-zinc-200 disabled:opacity-40"
            disabled={disabled}
            onClick={() => {
              const label = `Option ${list.length + 1}`;
              write([...list, { value: keyFrom(label, list.map((entry) => entry.value)), label }]);
            }}
          >
            <Plus size={12} />
            Add option
          </button>
          <p className="text-[11px] text-zinc-600">
            Renaming a choice keeps the value records already hold.
          </p>
        </div>
      );
    }

    case "values": {
      const values = (value ?? {}) as Record<string, unknown>;
      const fields = fieldsFor(control.objectFrom, draft, context);
      const entries = Object.entries(values);
      const unused = fields.filter((field) => !(field.id in values));

      return (
        <div className="flex flex-col gap-1.5">
          {entries.map(([fieldId, entryValue]) => {
            const field = fields.find((candidate) => candidate.id === fieldId);
            return (
              <div key={fieldId} className="flex flex-col gap-1 rounded-lg border border-zinc-800/80 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-zinc-300">{field?.label ?? fieldId}</span>
                  <button
                    type="button"
                    className={iconButton}
                    disabled={disabled}
                    title="Remove"
                    aria-label={`Stop setting ${field?.label ?? fieldId}`}
                    onClick={() => {
                      const next = { ...values };
                      delete next[fieldId];
                      write(next);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
                {valueInputFor(field, entryValue, (next) => write({ ...values, [fieldId]: next }), disabled)}
              </div>
            );
          })}
          {unused.length > 0 && (
            <Select
              value={undefined}
              options={unused.map((field) => ({ value: field.id, label: field.label }))}
              disabled={disabled}
              placeholder="Set another field…"
              onCommit={(fieldId) => fieldId && write({ ...values, [fieldId]: "" })}
            />
          )}
        </div>
      );
    }
  }
}

export { TextInput, Select, Toggle, labelClass, inputClass, iconButton };
export type { ObjectKey };
