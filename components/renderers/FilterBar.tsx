"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { OPERATORS_BY_TYPE } from "@/lib/config/schema";
import type {
  FieldConfig,
  FilterCondition,
  FilterOperator,
  FilterTree,
  ObjectConfig,
} from "@/lib/config/types";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { FieldRenderer, type FieldLookup } from "./FieldRenderer";
import { cn } from "@/lib/utils";

/**
 * A typed filter tree, not a query string. Operators come from the field type,
 * and the whole thing serialises straight into the view config — which is why
 * the query resolver never has to parse anything.
 */

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  between: "is between",
  in_last_days: "is in the last (days)",
  in_next_days: "is in the next (days)",
  is_any_of: "is any of",
  has_any_of: "has any of",
  has_all_of: "has all of",
  is_true: "is yes",
  is_false: "is no",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

const VALUELESS: FilterOperator[] = ["is_true", "is_false", "is_empty", "is_not_empty"];

export interface FilterBarProps {
  object: ObjectConfig;
  filters: FilterTree;
  onChange: (filters: FilterTree) => void;
  lookup?: FieldLookup;
  className?: string;
}

export const emptyFilterTree: FilterTree = { join: "and", conditions: [], groups: [] };

/**
 * A condition the user has started but not finished — a field chosen, no value
 * typed yet — should show everything, not fail. The query resolver stays
 * strict about what it accepts; this is where half-built rows are dropped.
 */
export function completeConditionsOnly(filters: FilterTree): FilterTree {
  const usable = (condition: FilterCondition): boolean => {
    if (VALUELESS.includes(condition.operator)) return true;
    const value = condition.value;
    if (value === undefined || value === null || value === "") return false;
    if (Array.isArray(value)) {
      return value.length > 0 && value.every((entry) => entry !== null && entry !== undefined && entry !== "");
    }
    return true;
  };

  return {
    join: filters.join,
    conditions: filters.conditions.filter(usable),
    groups: filters.groups
      .map((group) => ({ ...group, conditions: group.conditions.filter(usable) }))
      .filter((group) => group.conditions.length > 0),
  };
}

export function FilterBar({ object, filters, onChange, lookup, className }: FilterBarProps) {
  const fields = object.fields;
  const byId = React.useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);

  const setCondition = (index: number, condition: FilterCondition) => {
    const conditions = [...filters.conditions];
    conditions[index] = condition;
    onChange({ ...filters, conditions });
  };

  const addCondition = () => {
    const field = fields[0];
    if (!field) return;
    const operator = OPERATORS_BY_TYPE[field.type][0]!;
    onChange({ ...filters, conditions: [...filters.conditions, { fieldId: field.id, operator }] });
  };

  const removeCondition = (index: number) => {
    onChange({ ...filters, conditions: filters.conditions.filter((_, i) => i !== index) });
  };

  const setGroupCondition = (groupIndex: number, index: number, condition: FilterCondition) => {
    const groups = filters.groups.map((group, gi) => {
      if (gi !== groupIndex) return group;
      const conditions = [...group.conditions];
      conditions[index] = condition;
      return { ...group, conditions };
    });
    onChange({ ...filters, groups });
  };

  const addGroup = () => {
    const field = fields[0];
    if (!field) return;
    const operator = OPERATORS_BY_TYPE[field.type][0]!;
    onChange({
      ...filters,
      groups: [...filters.groups, { join: "or", conditions: [{ fieldId: field.id, operator }] }],
    });
  };

  const total = filters.conditions.length + filters.groups.reduce((sum, g) => sum + g.conditions.length, 0);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} role="group" aria-label="Filters">
      {total > 0 ? (
        <Select
          aria-label="Combine filters with"
          className="w-20"
          value={filters.join}
          onChange={(event) => onChange({ ...filters, join: event.target.value as "and" | "or" })}
        >
          <option value="and">All of</option>
          <option value="or">Any of</option>
        </Select>
      ) : null}

      {filters.conditions.map((condition, index) => (
        <ConditionRow
          key={index}
          fields={fields}
          field={byId.get(condition.fieldId)}
          condition={condition}
          lookup={lookup}
          onChange={(next) => setCondition(index, next)}
          onRemove={() => removeCondition(index)}
        />
      ))}

      {filters.groups.map((group, groupIndex) => (
        <div
          key={groupIndex}
          className="flex flex-wrap items-center gap-2 rounded border border-edge px-2 py-2"
        >
          <Select
            aria-label="Combine this group with"
            className="w-20"
            value={group.join}
            onChange={(event) => {
              const groups = filters.groups.map((existing, gi) =>
                gi === groupIndex ? { ...existing, join: event.target.value as "and" | "or" } : existing,
              );
              onChange({ ...filters, groups });
            }}
          >
            <option value="and">All of</option>
            <option value="or">Any of</option>
          </Select>

          {group.conditions.map((condition, index) => (
            <ConditionRow
              key={index}
              fields={fields}
              field={byId.get(condition.fieldId)}
              condition={condition}
              lookup={lookup}
              onChange={(next) => setGroupCondition(groupIndex, index, next)}
              onRemove={() => {
                const groups = filters.groups
                  .map((existing, gi) =>
                    gi === groupIndex
                      ? { ...existing, conditions: existing.conditions.filter((_, i) => i !== index) }
                      : existing,
                  )
                  .filter((existing) => existing.conditions.length > 0);
                onChange({ ...filters, groups });
              }}
            />
          ))}
        </div>
      ))}

      <Button type="button" variant="ghost" size="sm" onClick={addCondition} className="gap-1.5 text-sm">
        <Plus size={14} aria-hidden />
        Filter
      </Button>

      {/* One level of nesting, and no more. */}
      {filters.conditions.length > 0 && filters.groups.length < 5 ? (
        <Button type="button" variant="ghost" size="sm" onClick={addGroup} className="gap-1.5 text-sm">
          <Plus size={14} aria-hidden />
          Group
        </Button>
      ) : null}

      {total > 0 ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(emptyFilterTree)} className="text-sm">
          Clear
        </Button>
      ) : null}
    </div>
  );
}

function ConditionRow({
  fields,
  field,
  condition,
  onChange,
  onRemove,
  lookup,
}: {
  fields: FieldConfig[];
  field: FieldConfig | undefined;
  condition: FilterCondition;
  onChange: (condition: FilterCondition) => void;
  onRemove: () => void;
  lookup?: FieldLookup;
}) {
  const operators = field ? OPERATORS_BY_TYPE[field.type] : [];
  const needsValue = !VALUELESS.includes(condition.operator);

  return (
    <div className="flex items-center gap-1 rounded border border-edge bg-surface px-1">
      <Select
        aria-label="Field"
        className="w-32 border-0"
        value={condition.fieldId}
        onChange={(event) => {
          const nextField = fields.find((f) => f.id === event.target.value);
          if (!nextField) return;
          const allowed = OPERATORS_BY_TYPE[nextField.type];
          const operator = allowed.includes(condition.operator) ? condition.operator : allowed[0]!;
          onChange({ fieldId: nextField.id, operator, value: undefined });
        }}
      >
        {fields.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Condition"
        className="w-36 border-0"
        value={condition.operator}
        onChange={(event) =>
          onChange({ ...condition, operator: event.target.value as FilterOperator, value: undefined })
        }
      >
        {operators.map((operator) => (
          <option key={operator} value={operator}>
            {OPERATOR_LABELS[operator]}
          </option>
        ))}
      </Select>

      {needsValue && field ? (
        <div className="w-40">
          {condition.operator === "in_last_days" || condition.operator === "in_next_days" ? (
            <Input
              type="number"
              aria-label="Days"
              className="border-0"
              value={condition.value === undefined ? "" : String(condition.value)}
              onChange={(event) => onChange({ ...condition, value: Number(event.target.value) })}
            />
          ) : condition.operator === "between" ? (
            <BetweenInput field={field} condition={condition} onChange={onChange} />
          ) : condition.operator === "is_any_of" ||
            condition.operator === "has_any_of" ||
            condition.operator === "has_all_of" ? (
            /* These operators take a list, so the input is a multi-select over
               whatever options the field itself offers. */
            <FieldRenderer
              field={{ ...field, type: "multi_select" }}
              value={Array.isArray(condition.value) ? condition.value : []}
              mode="edit"
              lookup={lookup}
              onChange={(value) => onChange({ ...condition, value })}
            />
          ) : (
            <FieldRenderer
              field={field}
              value={condition.value ?? null}
              mode="edit"
              lookup={lookup}
              className="border-0"
              onChange={(value) => onChange({ ...condition, value })}
              onCommit={(value) => onChange({ ...condition, value })}
            />
          )}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove this filter"
        className="px-1 text-content-muted hover:text-content"
      >
        <X size={12} aria-hidden />
      </button>
    </div>
  );
}

function BetweenInput({
  field,
  condition,
  onChange,
}: {
  field: FieldConfig;
  condition: FilterCondition;
  onChange: (condition: FilterCondition) => void;
}) {
  const value = Array.isArray(condition.value) ? condition.value : [null, null];
  const type = field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "number";

  return (
    <div className="flex items-center gap-1">
      <Input
        type={type}
        aria-label="From"
        className="border-0"
        value={value[0] === null || value[0] === undefined ? "" : String(value[0])}
        onChange={(event) => onChange({ ...condition, value: [event.target.value, value[1] ?? null] })}
      />
      <Input
        type={type}
        aria-label="To"
        className="border-0"
        value={value[1] === null || value[1] === undefined ? "" : String(value[1])}
        onChange={(event) => onChange({ ...condition, value: [value[0] ?? null, event.target.value] })}
      />
    </div>
  );
}
