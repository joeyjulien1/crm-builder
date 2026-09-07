"use client";

import * as React from "react";
import { AlertTriangle, Check, Send } from "lucide-react";
import type { ConfigPatch, ImpactSummary } from "@/lib/config/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The trust surface of the entire product. It renders a patch in plain
 * language, never JSON. Destructive changes carry the record count they would
 * affect, and anything that leaves the building — an email, a webhook — is
 * called out and confirmed separately, even inside an approved patch.
 *
 * Get this right and users let the agent restructure their CRM. Get it wrong
 * and they never trust it twice.
 *
 * It has two modes, and which one it is in is decided by the impact, not by a
 * preference. A change that only adds things applies on its own and this
 * becomes a record of what was built, with an undo. A change that destroys
 * something or leaves the building stops and asks first. Confirming everything
 * teaches people to click through the one prompt that mattered.
 */

export interface ConfigDiffProps {
  patches: ConfigPatch[];
  impact: ImpactSummary;
  onConfirm: () => void;
  onDiscard: () => void;
  /** Only offered once a change is applied, and only while it is the newest. */
  onUndo?: () => void;
  status?: "ready" | "applying" | "applied" | "undoing";
}

export function ConfigDiff({
  patches,
  impact,
  onConfirm,
  onDiscard,
  onUndo,
  status = "ready",
}: ConfigDiffProps) {
  const [externalApproved, setExternalApproved] = React.useState(false);
  const blocked = impact.hasExternalEffects && !externalApproved;
  const applied = status === "applied" || status === "undoing";

  return (
    <section
      className="rounded-2xl border border-zinc-800/90 bg-[#121215] text-zinc-200 shadow-xl"
      aria-label={`${patches.length === 1 ? "One change" : `${patches.length} changes`} to review`}
    >
      <header className="flex items-center gap-1.5 border-b border-zinc-800/60 px-3 py-2">
        {applied && <Check size={12} className="shrink-0 text-emerald-400" aria-hidden />}
        <h3 className="text-xs font-medium text-zinc-100">
          {applied
            ? patches.length === 1
              ? "One change applied"
              : `${patches.length} changes applied`
            : patches.length === 1
              ? "One change to review"
              : `${patches.length} changes to review`}
        </h3>
      </header>

      <ul className="flex flex-col gap-2 px-3 py-3">
        {impact.items.map((item, index) => (
          <li key={index} className="flex gap-2 text-sm">
            <span
              aria-hidden
              className={cn(
                "mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full",
                item.destructive ? "bg-red-500" : "bg-purple-400",
              )}
            />
            <div className="min-w-0">
              <p className="text-zinc-200">{item.description}</p>
              {item.destructive && item.affectedRecords !== undefined ? (
                <p className="flex items-center gap-1 text-xs text-red-400">
                  <AlertTriangle size={11} aria-hidden />
                  {item.affectedRecords === 0
                    ? "No records hold a value here"
                    : `${item.affectedRecords.toLocaleString()} ${
                        item.affectedRecords === 1 ? "record has" : "records have"
                      } a value that would be lost`}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {impact.hasExternalEffects && !applied ? (
        <div className="border-t border-zinc-800/60 px-3 py-3">
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={externalApproved}
              onChange={(event) => setExternalApproved(event.target.checked)}
              className="mt-[2px] h-3 w-3 accent-purple-400"
            />
            <span className="flex items-start gap-1 text-amber-400">
              <Send size={11} className="mt-[2px] shrink-0" aria-hidden />
              This sends email or calls an external service on your behalf. Approve that separately.
            </span>
          </label>
        </div>
      ) : null}

      <footer className="flex items-center gap-2 border-t border-zinc-800/60 px-3 py-2">
        {applied ? (
          onUndo && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onUndo}
              disabled={status === "undoing"}
              className="text-zinc-300 hover:text-white hover:bg-zinc-800"
            >
              {status === "undoing" ? "Undoing…" : "Undo"}
            </Button>
          )
        ) : (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={onConfirm}
              disabled={blocked || status === "applying"}
              className="bg-white text-black hover:bg-zinc-200 font-semibold"
            >
              {status === "applying" ? "Applying…" : "Apply changes"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDiscard}
              disabled={status === "applying"}
              className="text-zinc-300 hover:text-white hover:bg-zinc-800"
            >
              Discard
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}
