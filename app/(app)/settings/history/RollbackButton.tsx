"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { rollbackAction } from "./actions";

export function RollbackButton({ version }: { version: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string>();

  if (!confirming) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
        Roll back to this
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={working}
          onClick={async () => {
            setWorking(true);
            setError(undefined);
            const result = await rollbackAction(version);
            setWorking(false);
            if (result?.error) {
              setError(result.error);
              return;
            }
            setConfirming(false);
            router.refresh();
          }}
        >
          {working ? "Rolling back…" : "Confirm"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={working}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
