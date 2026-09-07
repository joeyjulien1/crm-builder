"use client";

import * as React from "react";
import { CheckCircle2, CircleSlash, Clock, RefreshCw, XCircle } from "lucide-react";
import { studioCard, studioEyebrow } from "@/components/builder/studio-chrome";
import { cn } from "@/lib/utils";
import { STEP_LABELS } from "@/lib/config/controls";

/** One step's result, as `lib/automations/run.ts` reports it. */
export interface StepReport {
  stepId: string;
  type: string;
  status: "ran" | "stopped" | "skipped" | "waiting" | "would_run";
  detail: string;
}

export interface TestResult {
  reports: StepReport[];
  missingMergeFields: string[];
  recordTitle?: string;
  error?: string;
}

export interface RunSummary {
  id: string;
  status: string;
  error: string | null;
  createdAt: string;
  configVersion: number;
  steps: StepReport[];
}

/**
 * What happened, and what would happen.
 *
 * Two things sit under the builder: the last test, and the last twenty real
 * runs. Both read the same step reports, so a test that says "emails
 * alice@example.com" and a run that says the same thing are the same sentence.
 */
export function RunPanel({
  test,
  testing,
  runs,
  loadingRuns,
  onRefresh,
}: {
  test: TestResult | null;
  testing: boolean;
  runs: RunSummary[];
  loadingRuns: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 pb-8">
      {(test || testing) && (
        <section>
          <p className={cn(studioEyebrow, "mb-2")}>Test run</p>
          <div className={cn(studioCard, "p-3")}>
            {testing && <p className="text-xs text-zinc-400">Running against one record…</p>}

            {test?.error && <p className="text-xs text-amber-500">{test.error}</p>}

            {test && !test.error && (
              <>
                <p className="mb-2 text-[11px] text-zinc-500">
                  Nothing was changed, sent or called
                  {test.recordTitle ? ` — tested against ${test.recordTitle}` : ""}.
                </p>
                <ol className="flex flex-col gap-1.5">
                  {test.reports.map((report, index) => (
                    <li key={`${report.stepId}-${index}`} className="flex items-start gap-2">
                      <StatusIcon status={report.status} />
                      <span className="min-w-0">
                        <span className="block text-xs text-zinc-200">
                          {STEP_LABELS[report.type] ?? report.type}
                        </span>
                        <span className="block text-[11px] text-zinc-500">{report.detail}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                {test.reports.length === 0 && (
                  <p className="text-xs text-zinc-500">This workflow has no steps yet.</p>
                )}
                {test.missingMergeFields.length > 0 && (
                  <p className="mt-2 text-[11px] text-amber-500">
                    These merge fields came back empty on that record:{" "}
                    {test.missingMergeFields.join(", ")}.
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <p className={studioEyebrow}>Recent runs</p>
          <button
            type="button"
            className="flex items-center gap-1.5 text-[11px] text-zinc-500 transition-colors hover:text-zinc-200"
            onClick={onRefresh}
            disabled={loadingRuns}
          >
            <RefreshCw size={11} className={cn(loadingRuns && "animate-spin")} aria-hidden="true" />
            Refresh
          </button>
        </div>

        {runs.length === 0 ? (
          <p className="text-xs text-zinc-600">
            No runs yet. Turn this on and it fires the next time a matching record changes.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {runs.map((run) => (
              <li key={run.id} className={cn(studioCard, "flex items-start gap-2 px-3 py-2")}>
                <StatusIcon status={run.status} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-zinc-200">
                    {runLabel(run.status)}
                    <span className="ml-2 text-[11px] text-zinc-600">
                      {new Date(run.createdAt).toLocaleString()}
                    </span>
                  </span>
                  {run.error && <span className="block text-[11px] text-red-400">{run.error}</span>}
                  {run.steps.length > 0 && (
                    <span className="block truncate text-[11px] text-zinc-600">
                      {run.steps.map((step) => step.detail).join(" · ")}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-700">v{run.configVersion}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function runLabel(status: string): string {
  if (status === "completed") return "Ran through";
  if (status === "skipped") return "Stopped at a filter";
  if (status === "waiting") return "Waiting on a delay";
  if (status === "failed") return "Failed";
  if (status === "depth_exceeded") return "Stopped — too many chained automations";
  if (status === "duplicate") return "Already run";
  return status;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "failed") return <XCircle size={13} className="mt-0.5 shrink-0 text-red-400" aria-hidden="true" />;
  if (status === "waiting") return <Clock size={13} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />;
  if (status === "stopped" || status === "skipped") {
    return <CircleSlash size={13} className="mt-0.5 shrink-0 text-zinc-500" aria-hidden="true" />;
  }
  return <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden="true" />;
}
