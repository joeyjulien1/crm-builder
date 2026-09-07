"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { controlApplies, type ControlGroup } from "@/lib/config/controls";
import { ControlInput, labelClass, type ControlContext } from "./controls";
import { cn } from "@/lib/utils";

/**
 * The right pane: whatever is selected, as a form.
 *
 * It is handed a value and a list of groups from `lib/config/controls.ts` and
 * renders them. It does not know whether it is editing a screen node, a field
 * or a workflow step, which is the point — one panel, and adding a thing to
 * edit means describing its controls, not writing another panel.
 *
 * `onCommit` receives the whole edited value, and the pane above it turns that
 * into a patch. The inspector never talks to the API.
 */
export function Inspector<T>({
  title,
  subtitle,
  groups,
  value,
  context,
  disabled,
  onCommit,
  footer,
}: {
  title: string;
  subtitle?: string;
  groups: ControlGroup[];
  value: T;
  context: ControlContext;
  disabled?: boolean;
  onCommit: (next: T) => void;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-zinc-800/80 px-3.5 py-3">
        <h2 className="truncate text-xs font-semibold text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 truncate text-[11px] text-zinc-500">{subtitle}</p>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map((group) => (
          <Group
            key={group.label}
            group={group}
            value={value}
            context={context}
            disabled={disabled}
            onCommit={onCommit}
          />
        ))}
        {footer}
      </div>
    </div>
  );
}

function Group<T>({
  group,
  value,
  context,
  disabled,
  onCommit,
}: {
  group: ControlGroup;
  value: T;
  context: ControlContext;
  disabled?: boolean;
  onCommit: (next: T) => void;
}) {
  const [open, setOpen] = React.useState(!group.collapsed);
  const visible = group.controls.filter((control) => controlApplies(control, value));
  if (visible.length === 0) return null;

  return (
    <section className="border-b border-zinc-800/60">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3.5 py-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="text-[10px] font-mono font-medium uppercase tracking-wider text-zinc-500">
          {group.label}
        </span>
        <ChevronDown
          size={13}
          className={cn("text-zinc-600 transition-transform", open ? "" : "-rotate-90")}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3 px-3.5 pb-3.5">
          {visible.map((control) => (
            <div key={control.key} className="flex flex-col gap-1">
              {control.kind !== "toggle" && <label className={labelClass}>{control.label}</label>}
              <ControlInput
                control={control}
                draft={value}
                context={context}
                disabled={disabled}
                commit={(next) => onCommit(next as T)}
              />
              {control.help && <p className="text-[11px] leading-snug text-zinc-600">{control.help}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** The empty right pane. Names what a click would do rather than describing absence. */
export function InspectorEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="text-xs leading-relaxed text-zinc-600">{children}</p>
    </div>
  );
}
