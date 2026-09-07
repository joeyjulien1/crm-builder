"use client";

import * as React from "react";
import type { FieldConfig, ObjectConfig } from "@/lib/config/types";
import { validateRecord } from "@/lib/runtime/field";
import { Button } from "@/components/ui/button";
import { FieldRenderer, type FieldLookup } from "./FieldRenderer";
import { ErrorState } from "./states";
import { cn } from "@/lib/utils";

/**
 * Drives creation, editing, and public forms from the same config. Validation
 * comes from the field config — required, type, options — never from rules
 * hand-written per form.
 */

export interface FormRendererProps {
  object: ObjectConfig;
  fields: FieldConfig[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  status?: "ready" | "submitting" | "error";
  error?: string;
  /** Server-side field errors, merged with what validates here. */
  fieldErrors?: Record<string, string>;
  lookup?: FieldLookup;
  className?: string;
}

export function FormRenderer({
  object,
  fields,
  values,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  status = "ready",
  error,
  fieldErrors,
  lookup,
  className,
}: FormRendererProps) {
  const formId = React.useId();
  const submitting = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string>();
  const busy = pending || status === "submitting";
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = React.useState(false);

  const localErrors = React.useMemo(() => validateRecord(fields, values), [fields, values]);
  const errors = { ...localErrors, ...fieldErrors };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || busy) return;
    setSubmitError(undefined);
    setSubmitAttempted(true);
    if (Object.keys(localErrors).length > 0) {
      const firstInvalid = fields.find((field) => localErrors[field.id]);
      if (firstInvalid) document.getElementById(`${formId}-${firstInvalid.id}`)?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    try { await onSubmit(values); }
    catch (caught) { setSubmitError(caught instanceof Error ? caught.message : "This record could not be saved. Try again."); }
    finally { submitting.current = false; setPending(false); }
  };

  return (
    <form onSubmit={handleSubmit} className={cn("flex flex-col gap-5", className)} noValidate>
      {(submitError || (status === "error" && error)) ? <ErrorState message={submitError || error!} /> : null}

      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
        {fields.map((field) => {
          const inputId = `${formId}-${field.id}`;
          const showError = Boolean(errors[field.id]) && (touched[field.id] || submitAttempted);
          return (
            <div key={field.id} className="flex flex-col gap-2">
              <label htmlFor={inputId} className="text-xs font-medium text-content-secondary">
                {field.label}
                {field.required ? (
                  <span className="text-[var(--danger)]" aria-hidden>
                    {" "}
                    *
                  </span>
                ) : null}
              </label>

              <div>
                <FieldRenderer
                  field={field}
                  inputId={inputId}
                  describedBy={showError ? `${inputId}-error` : field.helpText ? `${inputId}-help` : undefined}
                  value={values[field.id] ?? null}
                  mode="edit"
                  invalid={showError}
                  lookup={lookup}
                  onChange={(value) => onChange({ ...values, [field.id]: value })}
                  onCommit={(value) => {
                    setTouched((previous) => ({ ...previous, [field.id]: true }));
                    onChange({ ...values, [field.id]: value });
                  }}
                />
              </div>

              {showError ? (
                <p id={`${inputId}-error`} role="alert" className="text-xs text-[var(--danger)]">
                  {errors[field.id]}
                </p>
              ) : field.helpText ? (
                <p id={`${inputId}-help`} className="text-xs text-content-muted">{field.helpText}</p>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : (submitLabel ?? `Save ${object.label.toLowerCase()}`)}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
