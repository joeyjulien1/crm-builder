"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * What the agent posts when it needs an account it does not have.
 *
 * It appears in the conversation, at the point the agent got stuck, with the
 * button that unsticks it. The alternative — telling someone to go to settings
 * and come back — is where the task gets abandoned.
 */
export function ConnectPrompt({
  provider,
  label,
  reason,
  connected,
  account,
  busy,
  onConnect,
}: {
  provider: string;
  label: string;
  reason: string;
  connected: boolean;
  account?: string;
  busy: boolean;
  onConnect: (provider: string) => void;
}) {
  return (
    <div className="rounded border border-edge bg-surface p-3">
      {connected ? (
        <div className="flex items-center gap-2">
          <Badge tone="success">Connected</Badge>
          <p className="min-w-0 truncate text-xs text-content-secondary">
            {label}
            {account ? ` — ${account}` : ""}. Ask again and the agent can use it.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm">{reason}</p>
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => onConnect(provider)}>
              {busy ? "Connecting…" : `Connect ${label}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
