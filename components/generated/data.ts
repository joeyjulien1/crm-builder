"use client";

import * as React from "react";
import {
  createRecordAction,
  queryRecordsAction,
  updateRecordFieldAction,
} from "@/app/(app)/actions";
import type { CrmRecord, FilterTree, Sort } from "@/lib/config/types";

/**
 * What a coded screen uses to reach records.
 *
 * This is the whole data surface. A screen names an object and a typed filter
 * tree — never a table, a column or a predicate — and the server compiles that
 * through `planViewQuery` inside a tenant-scoped transaction. So the reach of a
 * screen the agent wrote is identical to the reach of one a person composed,
 * and neither can express a query the config does not permit.
 *
 * Everything here is designed to be pleasant to write against, because the
 * model writes against it: a hook returns `{ records, total, loading, error,
 * reload }` and never throws, so a screen that asks for an object which has
 * since been renamed renders an empty state rather than a stack trace.
 */

export interface RecordQuery {
  filters?: FilterTree;
  sort?: Sort;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface RecordsResult {
  records: CrmRecord[];
  total: number;
  /** Display titles for anything a relation field points at, by record id. */
  titles: Record<string, string>;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useRecords(objectKey: string, query: RecordQuery = {}): RecordsResult {
  const [state, setState] = React.useState<{
    records: CrmRecord[];
    total: number;
    titles: Record<string, string>;
  }>({ records: [], total: 0, titles: {} });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  // A screen rebuilds its query object on every render, so compare by value.
  // Without this a coded screen would refetch in a loop, per render, forever.
  const key = JSON.stringify([objectKey, query]);

  React.useEffect(() => {
    let live = true;
    setLoading(true);

    const [key0, options] = JSON.parse(key) as [string, RecordQuery];
    void queryRecordsAction(key0, options)
      .then((page) => {
        if (!live) return;
        setState({ records: page.records, total: page.total, titles: page.titles });
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!live) return;
        setState({ records: [], total: 0, titles: {} });
        setError(caught instanceof Error ? caught.message : "Those records could not be read.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [key, nonce]);

  const reload = React.useCallback(() => setNonce((current) => current + 1), []);

  return { ...state, loading, error, reload };
}

/** One record by id, from a list the screen already has, or on its own. */
export function useRecord(objectKey: string, recordId: string | undefined): {
  record: CrmRecord | undefined;
  loading: boolean;
  error: string | null;
} {
  const { records, loading, error } = useRecords(objectKey, { limit: 500 });
  return {
    record: recordId ? records.find((candidate) => candidate.id === recordId) : undefined,
    loading,
    error,
  };
}

export interface WriteResult {
  ok: boolean;
  /** What to show the user. Field-level messages come back keyed by field id. */
  error?: string;
  fieldErrors?: Record<string, string>;
  id?: string;
}

export async function createRecord(
  objectKey: string,
  values: Record<string, unknown>,
): Promise<WriteResult> {
  try {
    const result = await createRecordAction(objectKey as never, values);
    if ("ok" in result) return { ok: true, id: result.id };
    return { ok: false, error: result.message, fieldErrors: result.fieldErrors };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "That could not be saved." };
  }
}

export async function updateRecord(
  recordId: string,
  fieldId: string,
  value: unknown,
): Promise<WriteResult> {
  try {
    const result = await updateRecordFieldAction(recordId, fieldId, value);
    if ("ok" in result) return { ok: true };
    return { ok: false, error: result.message, fieldErrors: result.fieldErrors };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "That could not be saved." };
  }
}
