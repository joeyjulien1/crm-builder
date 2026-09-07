import type { FieldConfig, ObjectConfig } from "@/lib/config/types";
import { coerceValue } from "@/lib/runtime/field";

/**
 * A first guess at which column is which, made locally. The agent can propose a
 * better one on request, but an upload should not cost a model call — see the
 * cost rule in CLAUDE.md.
 */
export interface MappingProposal {
  mapping: Record<string, string>;
  unmapped: string[];
  dedupeKey?: string;
}

export function proposeMapping(
  object: ObjectConfig,
  headers: string[],
  rows: string[][],
): MappingProposal {
  const mapping: Record<string, string> = {};
  const unmapped: string[] = [];
  const taken = new Set<string>();

  for (const [index, header] of headers.entries()) {
    const field = bestField(object.fields, header, columnValues(rows, index), taken);
    if (field) {
      mapping[header] = field.id;
      taken.add(field.id);
    } else {
      unmapped.push(header);
    }
  }

  // Deduping on email is what people mean by "don't create duplicates".
  const emailField = object.fields.find((field) => field.type === "email" && taken.has(field.id));
  const titleField = object.fields.find((field) => field.id === object.titleFieldId && taken.has(field.id));

  return { mapping, unmapped, dedupeKey: emailField?.id ?? titleField?.id };
}

function columnValues(rows: string[][], index: number): string[] {
  return rows
    .slice(0, 20)
    .map((row) => row[index] ?? "")
    .filter((value) => value.trim() !== "");
}

function bestField(
  fields: FieldConfig[],
  header: string,
  values: string[],
  taken: Set<string>,
): FieldConfig | undefined {
  const normalised = normalise(header);

  const candidates = fields.filter((field) => !taken.has(field.id));

  // An exact name match wins outright.
  const exact = candidates.find(
    (field) => normalise(field.label) === normalised || normalise(field.key) === normalised,
  );
  if (exact) return exact;

  const aliases: Record<string, string[]> = {
    name: ["full name", "contact", "customer", "account name", "company name", "deal name", "title"],
    email: ["email address", "e mail", "mail", "work email"],
    phone: ["telephone", "mobile", "phone number", "tel"],
    amount: ["value", "deal value", "revenue", "price", "total"],
    stage: ["status", "deal stage", "pipeline stage"],
    close_date: ["closing date", "expected close", "close"],
    domain: ["website", "url", "web"],
    job_title: ["title", "role", "position"],
    industry: ["sector", "vertical"],
    owner: ["assigned to", "account owner", "rep", "salesperson"],
  };

  for (const field of candidates) {
    const known = aliases[field.key];
    if (known?.some((alias) => normalise(alias) === normalised)) return field;
  }

  // Then a partial name match, but only if the values could hold that type.
  const partial = candidates.find(
    (field) =>
      (normalise(field.label).includes(normalised) || normalised.includes(normalise(field.label))) &&
      valuesFit(field, values),
  );
  if (partial) return partial;

  // Finally, shape: a column of things that all look like email addresses is an
  // email field even when the header says something unhelpful.
  if (values.length > 0 && values.every((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim()))) {
    return candidates.find((field) => field.type === "email");
  }

  return undefined;
}

function valuesFit(field: FieldConfig, values: string[]): boolean {
  if (values.length === 0) return true;
  const sample = values.slice(0, 10);
  const coerced = sample.map((value) => coerceValue(field, value));
  return coerced.filter((value) => value !== null).length >= Math.ceil(sample.length / 2);
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
