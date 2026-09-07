import type { FieldConfig, FieldType } from "@/lib/config/types";

/**
 * The field resolver: field config to the right input and display treatment.
 * Every renderer goes through here, which is what keeps a currency field
 * formatted identically in a table cell, a card, a detail panel, and a form.
 */

export type InputKind =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "date"
  | "datetime"
  | "checkbox"
  | "select"
  | "multi_select"
  | "email"
  | "phone"
  | "url"
  | "relation"
  | "user";

const INPUT_KIND: Record<FieldType, InputKind> = {
  text: "text",
  long_text: "textarea",
  number: "number",
  currency: "currency",
  date: "date",
  datetime: "datetime",
  boolean: "checkbox",
  select: "select",
  multi_select: "multi_select",
  email: "email",
  phone: "phone",
  url: "url",
  relation: "relation",
  user: "user",
};

export function inputKindFor(field: FieldConfig): InputKind {
  return INPUT_KIND[field.type];
}

/** Right-aligned in a table: numbers read better against a common edge. */
export function isNumericField(field: FieldConfig): boolean {
  return field.type === "number" || field.type === "currency";
}

export function defaultColumnWidth(field: FieldConfig): number {
  switch (field.type) {
    case "boolean":
      return 80;
    case "number":
    case "currency":
    case "date":
      return 120;
    case "datetime":
      return 160;
    case "long_text":
      return 280;
    default:
      return 180;
  }
}

/* -------------------------------------------------------------------------- */
/* Display                                                                     */
/* -------------------------------------------------------------------------- */

export interface DisplayContext {
  locale?: string;
  /** Resolves a relation or user id to something a person recognises. */
  labelFor?: (id: string) => string | undefined;
}

export function formatValue(
  field: FieldConfig,
  value: unknown,
  context: DisplayContext = {},
): string {
  if (value === null || value === undefined || value === "") return "";
  const locale = context.locale ?? "en-US";

  switch (field.type) {
    case "currency": {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return "";
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: field.currencyCode ?? "USD",
        maximumFractionDigits: 0,
      }).format(amount);
    }

    case "number": {
      const amount = Number(value);
      return Number.isFinite(amount) ? new Intl.NumberFormat(locale).format(amount) : "";
    }

    case "date": {
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) return "";
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
    }

    case "datetime": {
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) return "";
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
    }

    case "boolean":
      return value ? "Yes" : "No";

    case "select": {
      const option = field.options?.find((o) => o.value === value);
      return option?.label ?? String(value);
    }

    case "multi_select": {
      const values = Array.isArray(value) ? value : [value];
      return values
        .map((entry) => field.options?.find((o) => o.value === entry)?.label ?? String(entry))
        .join(", ");
    }

    case "relation":
    case "user":
      return context.labelFor?.(String(value)) ?? String(value);

    default:
      return String(value);
  }
}

/* -------------------------------------------------------------------------- */
/* Input                                                                       */
/* -------------------------------------------------------------------------- */

/** Turns whatever a form or an import produced into what gets stored. */
export function coerceValue(field: FieldConfig, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;

  switch (field.type) {
    case "number":
    case "currency": {
      if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
      // Strips currency symbols and thousands separators, but text that merely
      // contains no digits must come back empty rather than as zero.
      const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
      if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
      const amount = Number(cleaned);
      return Number.isFinite(amount) ? amount : null;
    }

    case "boolean": {
      if (typeof raw === "boolean") return raw;
      const text = String(raw).trim().toLowerCase();
      if (["true", "yes", "y", "1"].includes(text)) return true;
      if (["false", "no", "n", "0"].includes(text)) return false;
      return null;
    }

    case "date": {
      const date = new Date(String(raw));
      return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    }

    case "datetime": {
      const date = new Date(String(raw));
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    case "multi_select": {
      const values = Array.isArray(raw)
        ? raw.map(String)
        : String(raw)
            .split(/[,;]/)
            .map((entry) => entry.trim())
            .filter(Boolean);
      const allowed = new Set(field.options?.map((o) => o.value));
      const matched = values.map((entry) => matchOption(field, entry)).filter((entry): entry is string => Boolean(entry));
      return matched.filter((entry) => allowed.has(entry));
    }

    case "select":
      return matchOption(field, String(raw));

    case "email":
      return String(raw).trim().toLowerCase();

    default:
      return typeof raw === "string" ? raw.trim() : raw;
  }
}

/** Accepts either the stored value or the label a spreadsheet would carry. */
function matchOption(field: FieldConfig, raw: string): string | null {
  const term = raw.trim().toLowerCase();
  const match = field.options?.find(
    (option) => option.value.toLowerCase() === term || option.label.toLowerCase() === term,
  );
  return match?.value ?? null;
}

/**
 * Validation comes from the field config — required, type, options — not from
 * rules hand-written per form. Messages say what to enter.
 */
export function validateValue(field: FieldConfig, value: unknown): string | null {
  const empty =
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);

  if (field.required && empty) return `Enter a ${field.label.toLowerCase()}`;
  if (empty) return null;

  switch (field.type) {
    case "email":
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value))
        ? null
        : "Enter an email address, like name@company.com";

    case "url":
      return /^https?:\/\/.+/.test(String(value))
        ? null
        : "Enter a link starting with http:// or https://";

    case "phone":
      return /^[0-9+()\-.\s]{6,}$/.test(String(value))
        ? null
        : "Enter a phone number using digits, spaces, and + ( ) -";

    case "number":
    case "currency":
      return Number.isFinite(Number(value)) ? null : "Enter a number";

    case "date":
    case "datetime":
      return Number.isNaN(new Date(String(value)).getTime()) ? "Enter a valid date" : null;

    case "select":
      return field.options?.some((option) => option.value === value)
        ? null
        : `Choose one of the ${field.label.toLowerCase()} options`;

    case "multi_select": {
      const values = Array.isArray(value) ? value : [value];
      const allowed = new Set(field.options?.map((o) => o.value));
      return values.every((entry) => allowed.has(String(entry)))
        ? null
        : `Choose from the ${field.label.toLowerCase()} options`;
    }

    default:
      return null;
  }
}

export function validateRecord(
  fields: FieldConfig[],
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const error = validateValue(field, values[field.id]);
    if (error) errors[field.id] = error;
  }
  return errors;
}
