"use client";

import * as React from "react";
import { Plug } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ConnectorState } from "./useConnectors";
import { Input } from "@/components/ui/input";

/**
 * The connectors panel, opened from the composer.
 *
 * It sits where the work is. Sending someone to a settings page to connect an
 * account mid-conversation loses the conversation, and the reason they wanted
 * the account connected along with it.
 */

export interface ConnectorsPanelProps {
  connectors: ConnectorState[];
  loading: boolean;
  busy: string | null;
  error: string | null;
  onConnect: (provider: string) => void;
  onDisconnect: (provider: string) => void;
  onSaveCredentials: (provider: string, values: Record<string, string>) => Promise<boolean>;
}

export function ConnectorsPanel({
  connectors,
  loading,
  busy,
  error,
  onConnect,
  onDisconnect,
  onSaveCredentials,
}: ConnectorsPanelProps) {
  const [open, setOpen] = React.useState(false);
  const connectedCount = connectors.filter((c) => c.connected).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Connectors${connectedCount > 0 ? `, ${connectedCount} connected` : ""}`}
          title="Connectors"
          className="relative"
        >
          <Plug className="h-4 w-4" aria-hidden />
          {connectedCount > 0 && (
            <span
              className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--success)]"
              aria-hidden
            />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" side="top" className="w-[320px]">
        <div className="border-b border-edge px-3 py-2">
          <p className="text-sm font-medium">Connectors</p>
          <p className="mt-0.5 text-xs text-content-secondary">
            Connect an account and the agent can use it in this conversation.
          </p>
        </div>

        <div className="max-h-[320px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-4 text-xs text-content-secondary">
              <ThinkingOrb state="working" size={20} theme="auto" />
              <span>Loading connectors…</span>
            </div>
          ) : (
            connectors.map((connector) => (
              <ConnectorRow
                key={connector.provider}
                connector={connector}
                busy={busy === connector.provider}
                onConnect={onConnect}
                onDisconnect={onDisconnect}
                onSaveCredentials={onSaveCredentials}
              />
            ))
          )}
        </div>

        {error && (
          <p className="border-t border-edge px-3 py-2 text-xs text-[var(--danger)]">{error}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ConnectorRow({
  connector,
  busy,
  onConnect,
  onDisconnect,
  onSaveCredentials,
}: {
  connector: ConnectorState;
  busy: boolean;
  onConnect: (provider: string) => void;
  onDisconnect: (provider: string) => void;
  onSaveCredentials: (provider: string, values: Record<string, string>) => Promise<boolean>;
}) {
  const [entering, setEntering] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const fields = connector.credentialFields ?? [];
  const complete = fields.every((field) => (values[field.key] ?? "").trim() !== "");

  if (entering && !connector.connected) {
    return (
      <form
        className="flex flex-col gap-2 border-b border-edge px-3 py-2.5 last:border-b-0"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await onSaveCredentials(connector.provider, values)) {
            setEntering(false);
            setValues({});
          }
        }}
      >
        <p className="text-sm">Connect {connector.label}</p>
        {fields.map((field) => (
          <label key={field.key} className="flex flex-col gap-1">
            <span className="text-xs text-content-secondary">{field.label}</span>
            <Input
              type={field.secret ? "password" : "text"}
              value={values[field.key] ?? ""}
              autoComplete="off"
              className="text-sm"
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            />
            {field.help && <span className="text-xs text-content-muted">{field.help}</span>}
          </label>
        ))}
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" size="sm" disabled={!complete || busy}>
            {busy ? "Saving…" : "Connect"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setEntering(false);
              setValues({});
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-start justify-between gap-2 border-b border-edge px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm">{connector.label}</p>
        <p className="mt-0.5 truncate text-xs text-content-secondary">
          {connector.connected ? `Connected as ${connector.account}` : connector.blurb}
        </p>
        {!connector.configured && (
          <Badge tone="neutral" className="mt-1">
            Not set up on this deployment
          </Badge>
        )}
      </div>

      {connector.connected ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => onDisconnect(connector.provider)}
        >
          {busy ? "Disconnecting…" : "Disconnect"}
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !connector.configured}
          onClick={() =>
            connector.kind === "api_key" ? setEntering(true) : onConnect(connector.provider)
          }
        >
          {busy ? "Connecting…" : "Connect"}
        </Button>
      )}
    </div>
  );
}
