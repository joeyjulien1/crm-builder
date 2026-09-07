"use client";

import * as React from "react";

/**
 * Connection state, and the popup that changes it.
 *
 * The popup matters: a full-page redirect would throw away the conversation
 * the user is halfway through, which is the whole reason connecting lives in
 * the sidebar rather than in settings.
 */

export interface CredentialField {
  key: string;
  label: string;
  secret?: boolean;
  help?: string;
}

export interface ConnectorState {
  provider: string;
  label: string;
  blurb: string;
  /** "oauth2" opens a popup; "api_key" asks for values in place. */
  kind: "oauth2" | "api_key";
  credentialFields?: CredentialField[];
  configured: boolean;
  connected: boolean;
  connectionId?: string;
  account?: string;
  status?: string;
}

interface ConnectorMessage {
  source?: string;
  status?: string;
  provider?: string;
  account?: string;
  message?: string;
}

export function useConnectors() {
  const [connectors, setConnectors] = React.useState<ConnectorState[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch("/api/connectors");
      const body = (await response.json().catch(() => ({}))) as {
        connectors?: ConnectorState[];
        error?: string;
      };

      if (!response.ok || !body.connectors) {
        // The server knows why — a missing table, an unreachable database —
        // and saying so beats asking someone to try again at something that
        // will keep failing.
        throw new Error(body.error ?? "Connections could not be read.");
      }

      setConnectors(body.connectors);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connections could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // The popup reports back here rather than the sidebar polling for a change.
  React.useEffect(() => {
    function onMessage(event: MessageEvent<ConnectorMessage>) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== "connector") return;

      setBusy(null);
      if (data.status === "connected") {
        setError(null);
        void refresh();
      } else if (data.status === "error") {
        setError(data.message ?? "That connection could not be completed.");
      } else if (data.status === "cancelled") {
        setError(null);
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [refresh]);

  const connect = React.useCallback((provider: string) => {
    setError(null);
    setBusy(provider);

    const width = 520;
    const height = 640;
    // Centred on the window the user is actually looking at, not the screen.
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      `/api/connectors/${provider}/connect`,
      `connect_${provider}`,
      `width=${width},height=${height},left=${left},top=${top}`,
    );

    if (!popup) {
      setBusy(null);
      setError("Your browser blocked the sign-in window. Allow pop-ups for this site and try again.");
      return;
    }

    // A popup closed by hand sends no message, so stop showing it as pending.
    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer);
        setBusy((current) => (current === provider ? null : current));
      }
    }, 500);
  }, []);

  const disconnect = React.useCallback(
    async (provider: string) => {
      setBusy(provider);
      setError(null);
      try {
        const response = await fetch(`/api/connectors/${provider}/disconnect`, { method: "POST" });
        if (!response.ok) throw new Error();
        const body = (await response.json()) as { reason?: string };
        // Honest about the difference between "revoked" and "forgotten here".
        if (body.reason) setError(body.reason);
        await refresh();
      } catch {
        setError("That account could not be disconnected. Try again.");
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  /**
   * The other half of connecting: a provider with no OAuth flow takes its
   * values here instead of in a popup. Same table, same disconnect, same
   * refresh — only the way consent is given differs.
   */
  const saveCredentials = React.useCallback(
    async (provider: string, values: Record<string, string>): Promise<boolean> => {
      setBusy(provider);
      setError(null);
      try {
        const response = await fetch(`/api/connectors/${provider}/credentials`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values }),
        });
        if (!response.ok) {
          setError(await response.text());
          return false;
        }
        await refresh();
        return true;
      } catch {
        setError("That connection could not be saved. Try again.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  return { connectors, loading, busy, error, connect, disconnect, saveCredentials, refresh };
}
