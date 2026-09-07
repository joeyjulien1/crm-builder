"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { Config, CrmRecord, FieldConfig, FilterTree, Sort } from "@/lib/config/types";
import type { ResolvedView } from "@/lib/runtime/view";
import { TableView } from "@/components/renderers/TableView";
import { KanbanView } from "@/components/renderers/KanbanView";
import { RecordDetail } from "@/components/renderers/RecordDetail";
import { FormRenderer } from "@/components/renderers/FormRenderer";
import { completeConditionsOnly, emptyFilterTree, FilterBar } from "@/components/renderers/FilterBar";
import type { FieldLookup } from "@/components/renderers/FieldRenderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createRecordAction,
  listRecordsAction,
  saveColumnWidthsAction,
  updateRecordFieldAction,
} from "../../actions";

/**
 * The screen holds the state a view needs — sort, filters, search, selection —
 * and hands renderers their data as props. The renderers themselves never
 * fetch.
 */
export function ViewScreen({
  resolved,
  config,
  initialRecords,
  initialTotal,
  initialTitles,
  columnWidths: initialWidths,
}: {
  resolved: ResolvedView;
  config: Config;
  initialRecords: CrmRecord[];
  initialTotal: number;
  initialTitles: Record<string, string>;
  columnWidths: Record<string, number>;
}) {
  const router = useRouter();
  const { view, object } = resolved;

  const [records, setRecords] = React.useState(initialRecords);
  const [total, setTotal] = React.useState(initialTotal);
  const [titles, setTitles] = React.useState(initialTitles);
  const [status, setStatus] = React.useState<"loading" | "error" | "ready">("ready");
  const [error, setError] = React.useState<string>();
  const [loadingMore, setLoadingMore] = React.useState(false);
  const requestVersion = React.useRef(0);
  const pendingEdits = React.useRef(0);
  React.useEffect(() => () => { requestVersion.current++; }, []);
  const [sort, setSort] = React.useState<Sort | undefined>(view.sort);
  const [filters, setFilters] = React.useState<FilterTree>(view.filters ?? emptyFilterTree);
  const [search, setSearch] = React.useState("");
  const [widths, setWidths] = React.useState(initialWidths);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [openRecordId, setOpenRecordId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const createDialog = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => { if (creating) createDialog.current?.showModal(); }, [creating]);
  const [newValues, setNewValues] = React.useState<Record<string, unknown>>({});
  const [createError, setCreateError] = React.useState<string>();

  /**
   * The server payload seeds this screen; after that the client owns what is on
   * it. Re-syncing on every props change would let a background revalidation
   * overwrite a filtered result with the unfiltered one.
   */
  const seededView = React.useRef(view.id);
  React.useEffect(() => {
    if (seededView.current === view.id) return;
    seededView.current = view.id;
    requestVersion.current++;
    setStatus("ready");
    setError(undefined);
    setLoadingMore(false);
    setWidths(initialWidths);
    setCreating(false);
    setNewValues({});
    setCreateError(undefined);
    setRecords(initialRecords);
    setTotal(initialTotal);
    setTitles(initialTitles);
    setSort(view.sort);
    setFilters(view.filters ?? emptyFilterTree);
    setSearch("");
    setSelected([]);
    setOpenRecordId(null);
  }, [view.id, view.sort, view.filters, initialRecords, initialTotal, initialTitles]);

  const reload = React.useCallback(
    async (next: { sort?: Sort; filters?: FilterTree; search?: string; append?: boolean }) => {
      const version = ++requestVersion.current;
      if (next.append) setLoadingMore(true); else setStatus("loading");
      setError(undefined);
      try {
        const page = await listRecordsAction(view.id, {
          sort: next.sort ?? sort,
          filters: completeConditionsOnly(next.filters ?? filters),
          search: next.search ?? search,
          offset: next.append ? records.length : 0,
        });
        if (version !== requestVersion.current) return;
        setRecords((current) => next.append ? [...new Map([...current, ...page.records].map((record) => [record.id, record])).values()] : page.records);
        setTotal(page.total);
        setTitles((current) => next.append ? { ...current, ...page.titles } : page.titles);
        if (!next.append) setSelected([]);
        setStatus("ready");
      } catch (caught) {
        if (version !== requestVersion.current) return;
        setStatus(next.append ? "ready" : "error");
        setError(caught instanceof Error ? caught.message : "This view could not load.");
      } finally {
        if (version === requestVersion.current) setLoadingMore(false);
      }
    }, [view.id, sort, filters, search, records.length],
  );
  const reloadRef = React.useRef(reload);
  reloadRef.current = reload;
  const lastSearch = React.useRef("");
  const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (search === lastSearch.current) return;
    searchTimer.current = setTimeout(() => { lastSearch.current = search; void reloadRef.current({ search }); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  const lookup: FieldLookup = React.useMemo(
    () => ({
      labelFor: (id) => titles[id],
      optionsFor: (field: FieldConfig) => {
        if (field.type !== "relation") return [];
        return Object.entries(titles).map(([id, title]) => ({ value: id, label: title }));
      },
    }),
    [titles],
  );

  /** Optimistic: the cell shows the new value, and reverts if the save fails. */
  const commitEdit = async (recordId: string, fieldId: string, value: unknown) => {
    const previous = records.find((record) => record.id === recordId)?.data[fieldId];
    pendingEdits.current++;
    setRecords((current) => current.map((record) => record.id === recordId ? { ...record, data: { ...record.data, [fieldId]: value } } : record));
    let saved = false;
    try {
      const result = await updateRecordFieldAction(recordId, fieldId, value);
      if ("message" in result) throw new Error(result.message);
      saved = true;
      void fetch("/api/jobs/drain", { method: "POST" }).catch(() => {});
    } catch (caught) {
      setRecords((current) => current.map((record) => record.id === recordId && Object.is(record.data[fieldId], value) ? { ...record, data: { ...record.data, [fieldId]: previous } } : record));
      setError(caught instanceof Error ? caught.message : "This change could not be saved. Try again.");
    } finally {
      pendingEdits.current--;
      if (saved && pendingEdits.current === 0) void reloadRef.current({});
    }
  };

  const saveWidth = (fieldId: string, width: number) => {
    setWidths((current) => {
      const next = { ...current, [fieldId]: width };
      void saveColumnWidthsAction(view.id, next).catch(() => setError("Column widths could not be saved. Try resizing again."));
      return next;
    });
  };

  const openRecord = records.find((record) => record.id === openRecordId) ?? null;

  return (
    <div className="flex h-full min-w-0 flex-col">
      {error && status !== "error" && <p role="alert" className="border-b border-edge px-4 py-3 text-xs text-danger">{error}</p>}
      <div className="flex shrink-0 flex-col gap-2 border-b border-edge px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-base font-semibold">{view.name}</h1>
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { if (searchTimer.current) clearTimeout(searchTimer.current); lastSearch.current = search; void reload({ search }); }
              }}
              placeholder={`Search ${object.labelPlural.toLowerCase()}`}
              aria-label={`Search ${object.labelPlural}`}
              className="w-48 max-w-full text-sm sm:w-64"
            />
            <Button variant="primary" size="default" onClick={() => setCreating(true)} className="gap-2 text-sm font-medium">
              <Plus size={15} aria-hidden />
              New {object.label.toLowerCase()}
            </Button>
          </div>
        </div>

        <FilterBar
          object={object}
          filters={filters}
          lookup={lookup}
          onChange={(next) => {
            setFilters(next);
            void reload({ filters: next });
          }}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {resolved.renderer === "kanban" ? (
            <KanbanView
              view={view}
              pipeline={resolved.pipeline}
              stageField={resolved.stageField}
              cardFields={resolved.cardFields}
              sumField={resolved.sumField}
              records={records}
              status={status}
              error={error}
              lookup={lookup}
              onRetry={() => void reload({})}
              onOpenRecord={setOpenRecordId}
              onStageChange={(recordId, stageKey) =>
                void commitEdit(recordId, resolved.pipeline.stageFieldId, stageKey)
              }
              onCreate={(stageKey) => {
                setNewValues({ [resolved.pipeline.stageFieldId]: stageKey });
                setCreating(true);
              }}
            />
          ) : resolved.renderer === "table" ? (
            <TableView
              view={{ ...view, sort }}
              columns={resolved.columns}
              records={records}
              total={total}
              status={status}
              error={error}
              lookup={lookup}
              columnWidths={widths}
              selectedIds={selected}
              emptyTitle={`No ${object.labelPlural.toLowerCase()} yet.`}
              onRetry={() => void reload({})}
              onColumnWidthChange={saveWidth}
              onSelectionChange={setSelected}
              onSortChange={(next) => {
                setSort(next);
                void reload({ sort: next });
              }}
              onEditCommit={(recordId, fieldId, value) => void commitEdit(recordId, fieldId, value)}
              onOpenRecord={setOpenRecordId}
              onCreate={() => setCreating(true)}
              onImport={() => router.push("/settings/import")}
            />
          ) : (
            <div className="p-4 text-sm text-content-secondary">
              This view opens one record at a time. Pick one from a table or a board.
            </div>
          )}
        </div>

        {openRecord ? (
          <RecordDetail
            record={openRecord}
            object={object}
            lookup={lookup}
            onClose={() => setOpenRecordId(null)}
            onOpenRecord={(recordId) => router.push(`/records/${recordId}`)}
            onSave={async (fieldId, value) => {
              const result = await updateRecordFieldAction(openRecord.id, fieldId, value);
              if ("message" in result) throw new Error(result.message);
              void reload({});
            }}
          />
        ) : null}
      </div>

      {records.length < total && <div className="flex shrink-0 items-center justify-between gap-3 border-t border-edge px-4 py-3 text-xs text-content-secondary">
        <span>{records.length.toLocaleString()} of {total.toLocaleString()} records loaded</span>
        <Button disabled={loadingMore || status === "loading"} onClick={() => void reload({ append: true })}>{loadingMore ? "Loading more?" : "Load more"}</Button>
      </div>}

      {creating ? (
        <dialog ref={createDialog} aria-labelledby="new-record-title" onCancel={() => { setCreating(false); setNewValues({}); setCreateError(undefined); }} className="m-auto max-h-[85dvh] w-[480px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-edge bg-surface-raised p-5 text-content shadow-overlay backdrop:bg-black/50">
            <h2 id="new-record-title" className="mb-4 text-sm font-medium">New {object.label.toLowerCase()}</h2>
            <FormRenderer
              object={object}
              fields={object.fields}
              values={newValues}
              lookup={lookup}
              error={createError}
              status={createError ? "error" : "ready"}
              onChange={setNewValues}
              onCancel={() => {
                setCreating(false);
                setNewValues({});
                setCreateError(undefined);
              }}
              onSubmit={async (values) => {
                const result = await createRecordAction(object.key, values);
                if ("message" in result) {
                  setCreateError(result.message);
                  return;
                }
                setCreating(false);
                setNewValues({});
                setCreateError(undefined);
                void reload({});
              }}
            />
        </dialog>
      ) : null}
    </div>
  );
}
