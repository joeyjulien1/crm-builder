import { formatValue } from "@/lib/runtime/field";
import type { Config, CrmRecord, ObjectConfig } from "@/lib/config/types";

/**
 * Merge fields: `{{company_name}}` in an email body, a webhook payload, or the
 * value a step writes.
 *
 * Without these an automation can only send the same sentence to everyone,
 * which is not an automation anybody wants. The tokens name fields by their
 * **key** — the lower_snake_case name a person sees in the editor — rather than
 * by field id, because a template with `{{fld_7a2c}}` in it is unreadable and
 * unwritable by hand.
 *
 * A token that resolves to nothing renders as empty and is *reported*, not left
 * on the page as literal braces. Silently emailing a customer "Hi {{name}}" is
 * the failure mode this exists to avoid, and the run log names every token that
 * came back empty.
 */

const TOKEN = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi;

export interface MergeResult {
  text: string;
  /** Tokens that resolved to nothing, in the order they appeared. */
  missing: string[];
}

export interface MergeContext {
  config: Config;
  object: ObjectConfig | undefined;
  record: CrmRecord | undefined;
}

function lookup(token: string, context: MergeContext): string | undefined {
  const { object, record } = context;
  if (!record) return undefined;

  if (token === "record.id" || token === "id") return record.id;

  // "deal.amount" and "amount" both mean the triggering record's field, so a
  // template reads naturally either way.
  const key = token.includes(".") ? token.slice(token.indexOf(".") + 1) : token;
  const field = object?.fields.find((candidate) => candidate.key === key);
  if (!field) return undefined;

  const value = record.data[field.id];
  if (value === null || value === undefined || value === "") return undefined;

  const formatted = formatValue(field, value);
  return formatted === "" ? String(value) : formatted;
}

/** Substitutes every token in `template`. Pure, and never throws. */
export function mergeText(template: string, context: MergeContext): MergeResult {
  const missing: string[] = [];

  const text = template.replace(TOKEN, (_match, token: string) => {
    const resolved = lookup(token.toLowerCase(), context);
    if (resolved === undefined) {
      missing.push(token);
      return "";
    }
    return resolved;
  });

  return { text, missing };
}

/** Merges every string in a JSON payload, leaving other types alone. */
export function mergeValue(value: unknown, context: MergeContext): { value: unknown; missing: string[] } {
  const missing: string[] = [];

  const walk = (input: unknown): unknown => {
    if (typeof input === "string") {
      const result = mergeText(input, context);
      missing.push(...result.missing);
      return result.text;
    }
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, walk(v)]));
    }
    return input;
  };

  return { value: walk(value), missing };
}

/** Every token a template mentions, for the editor's "unknown field" warning. */
export function tokensIn(template: string): string[] {
  return [...template.matchAll(TOKEN)].map((match) => match[1]!.toLowerCase());
}
