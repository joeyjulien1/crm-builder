"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ObjectKey } from "@/lib/config/types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { ErrorState } from "@/components/renderers/states";
import {
  importStatusAction,
  startImportAction,
  uploadImportFileAction,
  type ImportStatus,
  type UploadResult,
} from "./actions";

/**
 * Upload, check the mapping, import. This is the moment that sells the product
 * — a prospect watching their own spreadsheet become a working CRM — so it
 * shows what it will do before it does it.
 */
export function ImportScreen({
  objects,
  viewByObject,
}: {
  objects: { key: ObjectKey; label: string; labelPlural: string }[];
  viewByObject: Record<string, string>;
}) {
  const router = useRouter();
  const [objectKey, setObjectKey] = React.useState<ObjectKey>(objects[0]?.key ?? "contact");
  const [upload, setUpload] = React.useState<UploadResult | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [dedupeKey, setDedupeKey] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<ImportStatus | null>(null);

  React.useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    const poll = async () => {
      // On a host with no worker process, the queue only moves when something
      // asks it to. Draining here is what makes the import run; where a real
      // worker is running it will simply have taken the job first.
      await fetch("/api/jobs/drain", { method: "POST" }).catch(() => {});
      if (cancelled) return;

      const status = await importStatusAction(jobId);
      if (cancelled || !status) return;
      setProgress(status);
      if (status.status !== "done" && status.status !== "failed") {
        setTimeout(() => void poll(), 700);
      }
    };
    void poll();

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const object = objects.find((candidate) => candidate.key === objectKey);

  const handleUpload = async (formData: FormData) => {
    setBusy(true);
    setError(undefined);
    const result = await uploadImportFileAction(objectKey, formData);
    setBusy(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }
    setUpload(result);
    setMapping(result.mapping);
    setDedupeKey(result.dedupeKey ?? "");
  };

  if (progress) {
    const done = progress.status === "done";
    const failed = progress.status === "failed";
    const percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

    return (
      <div className="h-full overflow-y-auto px-4 py-4">
        <h1 className="mb-1 text-sm font-medium">
          {done ? "Import finished" : failed ? "Import stopped" : "Importing…"}
        </h1>

        {failed ? (
          <ErrorState message={progress.error ?? "The import stopped partway."} />
        ) : (
          <>
            <div
              className="mb-3 h-1 w-full max-w-[400px] overflow-hidden rounded-sm bg-surface-hover"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full bg-[var(--accent)]" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-xs text-content-secondary">
              {progress.created.toLocaleString()} created · {progress.updated.toLocaleString()} updated ·{" "}
              {progress.skipped.toLocaleString()} skipped · {progress.processed.toLocaleString()} of{" "}
              {progress.total.toLocaleString()} rows
            </p>
          </>
        )}

        {done ? (
          <div className="mt-5 flex gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const viewId = viewByObject[objectKey];
                // Refresh so the record counts in the sidebar catch up with
                // what the background import just created.
                router.refresh();
                router.push(viewId ? `/views/${viewId}` : "/settings/history");
              }}
            >
              See the records
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setProgress(null);
                setJobId(null);
                setUpload(null);
              }}
            >
              Import another file
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <h1 className="mb-1 text-sm font-medium">Import a spreadsheet</h1>
      <p className="mb-5 text-xs text-content-secondary">
        A CSV with a header row. Nothing is imported until you have checked the mapping below.
      </p>

      {!upload ? (
        <form action={handleUpload} className="flex max-w-[420px] flex-col gap-4">
          <label className="flex flex-col gap-2 text-xs text-content-secondary">
            Import into
            <Select value={objectKey} onChange={(event) => setObjectKey(event.target.value as ObjectKey)}>
              {objects.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.labelPlural}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-2 text-xs text-content-secondary">
            File
            <input
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
              className="text-sm file:mr-3 file:h-control file:rounded file:border file:border-edge file:bg-surface file:px-3 file:text-sm"
            />
          </label>

          {error ? (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Reading…" : "Read the file"}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-xs text-content-secondary">
            {upload.filename} · {upload.rowCount.toLocaleString()} rows · importing into{" "}
            {object?.labelPlural.toLowerCase()}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full max-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs text-content-secondary">
                  <th className="py-2 pr-4 font-medium">Column in your file</th>
                  <th className="py-2 pr-4 font-medium">Example</th>
                  <th className="py-2 font-medium">Goes to</th>
                </tr>
              </thead>
              <tbody>
                {upload.headers.map((header, index) => (
                  <tr key={header} className="border-b border-edge">
                    <td className="py-2 pr-4">{header}</td>
                    <td className="max-w-[180px] truncate py-2 pr-4 text-content-muted">
                      {upload.sample[0]?.[index] ?? ""}
                    </td>
                    <td className="py-2">
                      <Select
                        aria-label={`Field for ${header}`}
                        value={mapping[header] ?? ""}
                        onChange={(event) => {
                          const next = { ...mapping };
                          if (event.target.value) next[header] = event.target.value;
                          else delete next[header];
                          setMapping(next);
                        }}
                      >
                        <option value="">Skip this column</option>
                        {upload.fields.map((field) => (
                          <option key={field.id} value={field.id}>
                            {field.label}
                            {field.required ? " (required)" : ""}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className="flex max-w-[420px] flex-col gap-2 text-xs text-content-secondary">
            Match existing records on
            <Select value={dedupeKey} onChange={(event) => setDedupeKey(event.target.value)}>
              <option value="">Nothing — create every row as new</option>
              {upload.fields
                .filter((field) => Object.values(mapping).includes(field.id))
                .map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.label}
                  </option>
                ))}
            </Select>
          </label>

          {error ? (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                const result = await startImportAction({
                  fileId: upload.fileId,
                  objectKey,
                  mapping,
                  dedupeKey: dedupeKey || undefined,
                });
                setBusy(false);
                if ("error" in result) {
                  setError(result.error);
                  return;
                }
                setJobId(result.importJobId);
              }}
            >
              Import {upload.rowCount.toLocaleString()} rows
            </Button>
            <Button variant="ghost" onClick={() => setUpload(null)} disabled={busy}>
              Choose a different file
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
