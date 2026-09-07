import { and, asc, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { records } from "@/lib/db/schema";
import { OPERATORS_BY_TYPE } from "@/lib/config/schema";
import { findField } from "@/lib/config/patch";
import type {
  Config,
  FieldConfig,
  FilterCondition,
  FilterTree,
  Sort,
  ViewConfig,
} from "@/lib/config/types";

/**
 * The query resolver: view config plus filter state, compiled to a Drizzle
 * query. Filters arrive as a typed tree, so nothing here parses anything, and
 * no value is ever concatenated into SQL — every one goes through a parameter.
 */

export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryError";
  }
}

/** `data ->> 'fld_x'` — the text form, which every operator starts from. */
function textOf(fieldId: string): SQL {
  return sql`${records.data} ->> ${fieldId}`;
}

/** A cast that yields null instead of erroring on data that isn't a number. */
function numberOf(fieldId: string): SQL {
  return sql`case when ${textOf(fieldId)} ~ '^-?[0-9]+(\.[0-9]+)?$' then (${textOf(fieldId)})::numeric end`;
}

/** Same idea for timestamps: unparseable values sort and compare as null. */
function timestampOf(fieldId: string): SQL {
  return sql`case when ${textOf(fieldId)} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then (${textOf(fieldId)})::timestamptz end`;
}

function isNumeric(field: FieldConfig): boolean {
  return field.type === "number" || field.type === "currency";
}

function isTemporal(field: FieldConfig): boolean {
  return field.type === "date" || field.type === "datetime";
}

function comparable(field: FieldConfig): SQL {
  if (isNumeric(field)) return numberOf(field.id);
  if (isTemporal(field)) return timestampOf(field.id);
  return textOf(field.id);
}

function coerce(field: FieldConfig, value: unknown): SQL {
  if (isNumeric(field)) return sql`${Number(value)}::numeric`;
  if (isTemporal(field)) return sql`${String(value)}::timestamptz`;
  return sql`${String(value)}`;
}

function requireValue(condition: FilterCondition): unknown {
  if (condition.value === undefined || condition.value === null) {
    throw new QueryError(`The ${condition.operator} filter needs a value`);
  }
  return condition.value;
}

function requireArray(condition: FilterCondition): unknown[] {
  const value = requireValue(condition);
  if (!Array.isArray(value)) throw new QueryError(`The ${condition.operator} filter needs a list of values`);
  return value;
}

/** One condition to one predicate. Operators are drawn from the field's type. */
export function compileCondition(config: Config, condition: FilterCondition): SQL {
  const found = findField(config, condition.fieldId);
  if (!found) throw new QueryError(`There is no field ${condition.fieldId} to filter on`);
  const field = found.field;

  const allowed = OPERATORS_BY_TYPE[field.type];
  if (!allowed.includes(condition.operator)) {
    throw new QueryError(`${field.label} cannot be filtered with ${condition.operator}`);
  }

  const text = textOf(field.id);
  const id = field.id;

  switch (condition.operator) {
    case "is":
      return sql`${comparable(field)} = ${coerce(field, requireValue(condition))}`;
    case "is_not":
      return sql`(${comparable(field)} is distinct from ${coerce(field, requireValue(condition))})`;
    case "contains":
      return sql`${text} ilike ${`%${escapeLike(String(requireValue(condition)))}%`}`;
    case "not_contains":
      return sql`coalesce(${text}, '') not ilike ${`%${escapeLike(String(requireValue(condition)))}%`}`;
    case "starts_with":
      return sql`${text} ilike ${`${escapeLike(String(requireValue(condition)))}%`}`;
    case "gt":
      return sql`${comparable(field)} > ${coerce(field, requireValue(condition))}`;
    case "gte":
      return sql`${comparable(field)} >= ${coerce(field, requireValue(condition))}`;
    case "lt":
      return sql`${comparable(field)} < ${coerce(field, requireValue(condition))}`;
    case "lte":
      return sql`${comparable(field)} <= ${coerce(field, requireValue(condition))}`;
    case "between": {
      const [from, to] = requireArray(condition);
      return sql`${comparable(field)} between ${coerce(field, from)} and ${coerce(field, to)}`;
    }
    case "in_last_days": {
      const days = Number(requireValue(condition));
      return sql`${timestampOf(id)} between now() - make_interval(days => ${days}) and now()`;
    }
    case "in_next_days": {
      const days = Number(requireValue(condition));
      return sql`${timestampOf(id)} between now() and now() + make_interval(days => ${days})`;
    }
    case "is_any_of":
      return sql`${text} = any(${textArray(requireArray(condition).map(String))})`;
    case "has_any_of":
      return sql`jsonb_exists_any(${records.data} -> ${id}, ${textArray(requireArray(condition).map(String))})`;
    case "has_all_of":
      return sql`jsonb_exists_all(${records.data} -> ${id}, ${textArray(requireArray(condition).map(String))})`;
    case "is_true":
      return sql`${text} = 'true'`;
    case "is_false":
      return sql`coalesce(${text}, 'false') = 'false'`;
    case "is_empty":
      return sql`(${text} is null or ${text} = '' or ${records.data} -> ${id} = '[]'::jsonb)`;
    case "is_not_empty":
      return sql`(${text} is not null and ${text} <> '' and ${records.data} -> ${id} <> '[]'::jsonb)`;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** `array[$1, $2]::text[]` — one bound parameter per value, never a literal. */
function textArray(values: string[]): SQL {
  if (values.length === 0) return sql`array[]::text[]`;
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

function join(join: "and" | "or", parts: SQL[]): SQL | undefined {
  if (parts.length === 0) return undefined;
  const combined = join === "and" ? and(...parts) : or(...parts);
  return combined;
}

/** The whole tree: conditions at the top, plus one permitted level of groups. */
export function compileFilters(config: Config, filters: FilterTree | undefined): SQL | undefined {
  if (!filters) return undefined;

  const parts: SQL[] = filters.conditions.map((condition) => compileCondition(config, condition));

  for (const group of filters.groups) {
    const inner = join(
      group.join,
      group.conditions.map((condition) => compileCondition(config, condition)),
    );
    if (inner) parts.push(sql`(${inner})`);
  }

  return join(filters.join, parts);
}

export function compileSort(config: Config, sort: Sort | undefined): SQL {
  if (!sort) return desc(records.updatedAt);
  const found = findField(config, sort.fieldId);
  if (!found) throw new QueryError(`There is no field ${sort.fieldId} to sort by`);

  const expression = comparable(found.field);
  return sort.direction === "asc"
    ? sql`${expression} asc nulls last`
    : sql`${expression} desc nulls last`;
}

export interface QueryPlan {
  where: SQL;
  orderBy: SQL;
  limit: number;
  offset: number;
}

export interface QueryOptions {
  /** Filters the user set on top of the view's own. */
  extraFilters?: FilterTree;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Compiles a view into a plan. The `tenant_id` predicate here is defence in
 * depth — RLS is what actually keeps tenants apart.
 */
export function planViewQuery(
  config: Config,
  view: ViewConfig,
  tenantId: string,
  options: QueryOptions = {},
): QueryPlan {
  const parts: SQL[] = [
    eq(records.tenantId, tenantId),
    eq(records.objectKey, view.objectKey),
    isNull(records.deletedAt),
  ];

  const viewFilters = compileFilters(config, view.filters);
  if (viewFilters) parts.push(viewFilters);

  const extra = compileFilters(config, options.extraFilters);
  if (extra) parts.push(extra);

  if (options.search?.trim()) {
    const search = compileSearch(config, view.objectKey, options.search.trim());
    if (search) parts.push(search);
  }

  return {
    where: and(...parts)!,
    orderBy: compileSort(config, view.sort),
    limit: Math.min(options.limit ?? 100, 500),
    offset: Math.max(options.offset ?? 0, 0),
  };
}

/** Free-text search across an object's text-ish fields. */
export function compileSearch(config: Config, objectKey: string, term: string): SQL | undefined {
  const object = config.objects.find((o) => o.key === objectKey);
  if (!object) return undefined;

  const searchable = object.fields.filter((field) =>
    ["text", "long_text", "email", "phone", "url"].includes(field.type),
  );
  if (searchable.length === 0) return undefined;

  const pattern = `%${escapeLike(term)}%`;
  return or(...searchable.map((field) => sql`${textOf(field.id)} ilike ${pattern}`));
}

export { asc, desc };
