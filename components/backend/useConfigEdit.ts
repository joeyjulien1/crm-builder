"use client";

import * as React from "react";
import type { Config, ConfigPatch } from "@/lib/config/types";

export interface ApplyResult {
  success: boolean;
  config?: Config;
  error?: string;
}

export interface ConfigEdit {
  /** Commits patches as one config version. Reports failure rather than throwing. */
  commit: (patches: ConfigPatch[]) => Promise<ApplyResult>;
  saving: boolean;
  /** The last failure, in the words the validator used. Cleared on the next commit. */
  error: string | null;
  clearError: () => void;
  canEdit: boolean;
}

/**
 * The one way the editor writes.
 *
 * Every control in every pane goes through here, so a hand edit is the same
 * thing as an agent edit: a validated patch, a new config version, a line in
 * change history, and a rollback that already works. Nothing in this editor
 * writes config any other way — that is what keeps invariant 2 true while the
 * surface area grows.
 *
 * Commit on blur, drag-end or an explicit save. Never on keystroke: a text
 * input that committed per character would mint forty versions to rename a
 * field, and change history is only useful if a version means a change someone
 * intended.
 */
export function useConfigEdit(
  apply: (patches: ConfigPatch[]) => Promise<ApplyResult>,
  canEdit: boolean,
): ConfigEdit {
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const commit = React.useCallback(
    async (patches: ConfigPatch[]): Promise<ApplyResult> => {
      if (!canEdit) {
        const refusal = "Your role cannot change this workspace's configuration.";
        setError(refusal);
        return { success: false, error: refusal };
      }
      if (patches.length === 0) return { success: true };

      setSaving(true);
      setError(null);
      try {
        const result = await apply(patches);
        if (!result.success) setError(result.error ?? "Those changes could not be saved.");
        return result;
      } finally {
        setSaving(false);
      }
    },
    [apply, canEdit],
  );

  const clearError = React.useCallback(() => setError(null), []);

  return { commit, saving, error, clearError, canEdit };
}
