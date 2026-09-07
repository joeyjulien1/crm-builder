"use client";

import * as React from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { studioButtonSecondary, studioEyebrow } from "@/components/builder/studio-chrome";
import { cn } from "@/lib/utils";

/**
 * The URL an outside system posts to.
 *
 * Minting it is the moment the workspace becomes reachable from outside, so it
 * takes a click rather than appearing the instant someone picks the trigger.
 * Revoking is a delete, and it is said plainly here: nothing else authenticates
 * a caller.
 */
export function WebhookEndpoint({
  automationId,
  objectKey,
  canEdit,
}: {
  automationId: string;
  objectKey: string;
  canEdit: boolean;
}) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/automations/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ automationId }),
      });
      if (!response.ok) {
        setError(await response.text());
        return;
      }
      const body = (await response.json()) as { url: string };
      setUrl(body.url);
    } catch {
      setError("That endpoint could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetch(`/api/automations/webhook?automationId=${encodeURIComponent(automationId)}`, {
        method: "DELETE",
      });
      setUrl(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-zinc-800/60 p-3.5">
      <p className={cn(studioEyebrow, "mb-1.5")}>Endpoint</p>

      {url ? (
        <>
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-zinc-800 bg-[#131316] px-2 py-1.5 font-mono text-[10px] text-zinc-300">
              {url}
            </code>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-800 text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-200"
              title="Copy the endpoint"
              aria-label="Copy the endpoint"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
            POST JSON here and its keys are matched to {objectKey} field keys, one record per post.
            Anything unrecognised is ignored. This URL is the only credential — anyone who has it can
            create records here.
          </p>
          {canEdit && (
            <button
              type="button"
              className="mt-2 text-[11px] text-zinc-500 transition-colors hover:text-red-400"
              disabled={busy}
              onClick={() => void revoke()}
            >
              Revoke this URL
            </button>
          )}
        </>
      ) : (
        <>
          <p className="mb-2 text-[11px] leading-relaxed text-zinc-600">
            This workflow starts when something posts to it. Create the URL when you are ready to hand
            it out.
          </p>
          <button type="button" className={studioButtonSecondary} disabled={!canEdit || busy} onClick={() => void create()}>
            <Link2 size={12} aria-hidden="true" />
            {busy ? "Creating…" : "Create the endpoint"}
          </button>
        </>
      )}

      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
