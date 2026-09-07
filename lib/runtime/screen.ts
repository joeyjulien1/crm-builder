import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { records } from "@/lib/db/schema";
import { findField } from "@/lib/config/patch";
import { compileFilters, compileSort, QueryError } from "./query";
import type { Config, CrmRecord, ObjectKey, ScreenConfig, UiNode } from "@/lib/config/types";

/**
 * Generated screens read real records. The agent composes the tree; this walks
 * it, runs each binding as its own tenant-scoped query, and hands the results
 * back keyed by the node's position in the tree.
 *
 * Every query is compiled from the same typed filter tree the views use, so a
 * generated screen has no more reach into the database than a hand-built one:
 * no value is concatenated into SQL, and RLS is what actually separates
 * tenants. The `tenant_id` predicate here is defence in depth.
 */

/** A node's address in the tree — "root.children.2.children.0". Stable across renders. */
export type NodePath = string;

export interface ScreenData {
  /** Records for every table, board, list and chart, by node path. */
  lists: Record<NodePath, { records: CrmRecord[]; total: number }>;
  /** Resolved values for every metric, by node path. */
  metrics: Record<NodePath, number | null>;
  /** Display titles for records referenced by a relation field. */
  titles: Record<string, string>;
}

const DATA_KINDS = new Set(["table", "board", "list", "chart"]);

/** Walks the tree in a fixed order, so paths mean the same thing here and in the renderer. */
export function walkNodes(root: UiNode, visit: (node: UiNode, path: NodePath) => void): void {
  const step = (node: UiNode, path: NodePath): void => {
    visit(node, path);
    node.children?.forEach((child, index) => step(child, `${path}.children.${index}`));
  };
  step(root, "root");
}

function baseWhere(tenantId: string, objectKey: string) {
  return [eq(records.tenantId, tenantId), eq(records.objectKey, objectKey), isNull(records.deletedAt)];
}

/** `data ->> 'fld_x'` cast to a number, yielding null rather than erroring. */
function numberOf(fieldId: string) {
  const text = sql`${records.data} ->> ${fieldId}`;
  return sql`case when ${text} ~ '^-?[0-9]+(\.[0-9]+)?$' then (${text})::numeric end`;
}

/**
 * Resolves everything one screen needs, in as few round trips as the tree
 * allows: one query per data node, one per metric.
 */
export async function resolveScreenData(
  db: Db,
  tenantId: string,
  config: Config,
  screen: ScreenConfig,
): Promise<ScreenData> {
  const lists: ScreenData["lists"] = {};
  const metrics: ScreenData["metrics"] = {};

  const dataNodes: { node: UiNode; path: NodePath }[] = [];
  const metricNodes: { node: UiNode; path: NodePath }[] = [];

  // A screen written as code declares what it reads by calling the data
  // client, one query at a time, from the browser. There is no tree to walk and
  // nothing to resolve up front.
  if (!screen.root) return { lists, metrics, titles: {} };

  walkNodes(screen.root, (node, path) => {
    if (DATA_KINDS.has(node.kind) && node.query) dataNodes.push({ node, path });
    if (node.aggregate) metricNodes.push({ node, path });
  });

  for (const { node, path } of dataNodes) {
    const query = node.query!;
    const parts = baseWhere(tenantId, query.objectKey);

    try {
      const filters = compileFilters(config, query.filters);
      if (filters) parts.push(filters);
    } catch (error) {
      // A filter the config can no longer satisfy — a field the agent removed,
      // say — empties that one node instead of failing the whole screen.
      if (!(error instanceof QueryError)) throw error;
      lists[path] = { records: [], total: 0 };
      continue;
    }

    const where = and(...parts)!;
    const rows = await db
      .select()
      .from(records)
      .where(where)
      .orderBy(compileSort(config, query.sort))
      .limit(Math.min(query.limit ?? 100, 500));

    const [counted] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(records)
      .where(where);

    lists[path] = {
      records: rows.map((row) => ({
        id: row.id,
        objectKey: row.objectKey as ObjectKey,
        data: row.data,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      total: counted?.count ?? 0,
    };
  }

  for (const { node, path } of metricNodes) {
    const aggregate = node.aggregate!;
    const parts = baseWhere(tenantId, aggregate.objectKey);

    try {
      const filters = compileFilters(config, aggregate.filters);
      if (filters) parts.push(filters);
    } catch (error) {
      if (!(error instanceof QueryError)) throw error;
      metrics[path] = null;
      continue;
    }

    const where = and(...parts)!;

    if (aggregate.fn === "count") {
      const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(records).where(where);
      metrics[path] = row?.value ?? 0;
      continue;
    }

    // Everything else needs a field, and it has to still exist.
    const found = aggregate.fieldId ? findField(config, aggregate.fieldId) : undefined;
    if (!found) {
      metrics[path] = null;
      continue;
    }

    const column = numberOf(found.field.id);
    const expression =
      aggregate.fn === "sum"
        ? sql<string | null>`sum(${column})`
        : aggregate.fn === "avg"
          ? sql<string | null>`avg(${column})`
          : aggregate.fn === "min"
            ? sql<string | null>`min(${column})`
            : sql<string | null>`max(${column})`;

    const [row] = await db.select({ value: expression }).from(records).where(where);
    metrics[path] = row?.value === null || row?.value === undefined ? null : Number(row.value);
  }

  return { lists, metrics, titles: {} };
}

/** Every record id a relation column on this screen points at. */
export function referencedRecordIds(config: Config, data: ScreenData, screen: ScreenConfig): string[] {
  const ids = new Set<string>();
  if (!screen.root) return [];

  walkNodes(screen.root, (node, path) => {
    const list = data.lists[path];
    if (!list || !node.query) return;

    const object = config.objects.find((candidate) => candidate.key === node.query!.objectKey);
    const relationFields = (object?.fields ?? []).filter((field) => field.type === "relation");

    for (const record of list.records) {
      for (const field of relationFields) {
        const value = record.data[field.id];
        if (value) ids.add(String(value));
      }
    }
  });

  return [...ids];
}
