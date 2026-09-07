import { findField } from "@/lib/config/patch";
import type { Config, FilterCondition } from "@/lib/config/types";

/**
 * Conditions are evaluated in JavaScript here, against a record already in
 * hand, and in SQL by the query resolver when filtering a view. The operator
 * set is the same one in both places — it comes from the field type.
 */
export function conditionHolds(
  config: Config,
  condition: FilterCondition,
  data: Record<string, unknown>,
): boolean {
  const found = findField(config, condition.fieldId);
  if (!found) return false;

  const value = data[condition.fieldId];
  const empty = value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  const text = empty ? "" : String(value);
  const target = condition.value;

  switch (condition.operator) {
    case "is":
      return compare(found.field.type, value, target) === 0;
    case "is_not":
      return compare(found.field.type, value, target) !== 0;
    case "contains":
      return text.toLowerCase().includes(String(target).toLowerCase());
    case "not_contains":
      return !text.toLowerCase().includes(String(target).toLowerCase());
    case "starts_with":
      return text.toLowerCase().startsWith(String(target).toLowerCase());
    case "gt":
      return !empty && compare(found.field.type, value, target) > 0;
    case "gte":
      return !empty && compare(found.field.type, value, target) >= 0;
    case "lt":
      return !empty && compare(found.field.type, value, target) < 0;
    case "lte":
      return !empty && compare(found.field.type, value, target) <= 0;
    case "between": {
      if (empty || !Array.isArray(target)) return false;
      return (
        compare(found.field.type, value, target[0]) >= 0 && compare(found.field.type, value, target[1]) <= 0
      );
    }
    case "in_last_days": {
      if (empty) return false;
      const when = new Date(text).getTime();
      const days = Number(target);
      return Number.isFinite(when) && when <= Date.now() && when >= Date.now() - days * 86_400_000;
    }
    case "in_next_days": {
      if (empty) return false;
      const when = new Date(text).getTime();
      const days = Number(target);
      return Number.isFinite(when) && when >= Date.now() && when <= Date.now() + days * 86_400_000;
    }
    case "is_any_of":
      return Array.isArray(target) && target.map(String).includes(text);
    case "has_any_of": {
      const values = Array.isArray(value) ? value.map(String) : [];
      return Array.isArray(target) && target.map(String).some((entry) => values.includes(entry));
    }
    case "has_all_of": {
      const values = Array.isArray(value) ? value.map(String) : [];
      return Array.isArray(target) && target.map(String).every((entry) => values.includes(entry));
    }
    case "is_true":
      return value === true;
    case "is_false":
      return value !== true;
    case "is_empty":
      return empty;
    case "is_not_empty":
      return !empty;
  }
}

function compare(type: string, left: unknown, right: unknown): number {
  if (type === "number" || type === "currency") {
    const a = Number(left);
    const b = Number(right);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    return a === b ? 0 : a > b ? 1 : -1;
  }
  if (type === "date" || type === "datetime") {
    const a = new Date(String(left)).getTime();
    const b = new Date(String(right)).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    return a === b ? 0 : a > b ? 1 : -1;
  }
  if (type === "boolean") return Boolean(left) === Boolean(right) ? 0 : 1;

  const a = left === null || left === undefined ? "" : String(left);
  const b = right === null || right === undefined ? "" : String(right);
  return a === b ? 0 : a > b ? 1 : -1;
}

export function allConditionsHold(
  config: Config,
  conditions: FilterCondition[],
  data: Record<string, unknown>,
): boolean {
  return conditions.every((condition) => conditionHolds(config, condition, data));
}
