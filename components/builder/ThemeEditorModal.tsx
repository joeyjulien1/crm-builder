"use client";

import * as React from "react";
import { X, AlertTriangle } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import type { ThemeConfig } from "@/lib/config/types";
import {
  BADGE_VARIANTS,
  BUTTON_VARIANTS,
  CARD_VARIANTS,
  INPUT_VARIANTS,
  SHADOW_STYLES,
  TABLE_VARIANTS,
  TABS_VARIANTS,
  THEME_FONTS,
} from "@/lib/config/schema";
import { assertReadable, resolveTheme, themeVars } from "@/lib/config/theme";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The theme, editable by hand.
 *
 * Everything here writes the same `update_theme` patch the agent writes, so a
 * change made with a colour picker is versioned and reversible exactly like a
 * generated one. The two editors share a data model rather than competing.
 *
 * Contrast is checked as you type, not on save: an unreadable palette is shown
 * as a warning against the offending pair while the preview still renders, so
 * you can see what you did before deciding to keep it. Saving is what enforces
 * it — the same floor the agent is held to.
 */

interface ThemeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: Partial<ThemeConfig>;
  onSave: (theme: Partial<ThemeConfig>) => Promise<{ success: boolean; error?: string }>;
}

type Draft = ThemeConfig;

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="flex min-w-0 flex-col">
        <span className="text-sm text-content">{label}</span>
        {hint && <span className="text-xs text-content-muted">{hint}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">{children}</span>
    </label>
  );
}

function ColorField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <>
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-9 cursor-pointer rounded border border-edge bg-transparent p-0"
        aria-label="Colour"
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-24 font-mono text-xs"
        spellCheck={false}
      />
    </>
  );
}

function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-28 accent-[var(--accent)]"
      />
      <span className="w-14 text-right font-mono text-xs tabular-nums text-content-secondary">
        {value}
        {suffix}
      </span>
    </>
  );
}

function VariantField<T extends readonly string[]>({
  options,
  value,
  onChange,
}: {
  options: T;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onChange={(event) => onChange(event.target.value)} className="w-36">
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </Select>
  );
}

const COLOR_ROLES: { key: keyof ThemeConfig["colors"]; label: string; hint?: string }[] = [
  { key: "surface", label: "Page", hint: "The background everything sits on" },
  { key: "sunken", label: "Sunken", hint: "Wells, table headers" },
  { key: "raised", label: "Raised", hint: "Cards and panels" },
  { key: "hover", label: "Hover" },
  { key: "textPrimary", label: "Body text" },
  { key: "textSecondary", label: "Secondary text" },
  { key: "textMuted", label: "Muted text" },
  { key: "borderSubtle", label: "Borders" },
  { key: "borderStrong", label: "Strong borders" },
  { key: "accent", label: "Accent", hint: "Buttons, links, focus" },
];

export function ThemeEditorModal({ isOpen, onClose, theme, onSave }: ThemeEditorModalProps) {
  const [draft, setDraft] = React.useState<Draft>(() => resolveTheme(theme));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<"colour" | "type" | "shape" | "components">("colour");

  React.useEffect(() => {
    if (isOpen) setDraft(resolveTheme(theme));
  }, [isOpen, theme]);

  const problems = React.useMemo(() => assertReadable(draft), [draft]);
  const preview = React.useMemo(() => themeVars(draft) as React.CSSProperties, [draft]);

  if (!isOpen) return null;

  const set = <K extends keyof Draft>(group: K, value: Partial<Draft[K]>) =>
    setDraft((current) => ({ ...current, [group]: { ...(current[group] as object), ...value } }));

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await onSave(draft);
    setSaving(false);
    if (result.success) onClose();
    else setError(result.error ?? "Could not save the theme.");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex h-[min(44rem,90vh)] w-[min(56rem,95vw)] flex-col overflow-hidden rounded-lg border border-edge bg-surface shadow-overlay">
        <header className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-content">Theme</h2>
            <p className="text-xs text-content-muted">Changes apply to every screen in this workspace.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-content-muted hover:text-content">
            <X size={16} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-[22rem] shrink-0 flex-col overflow-y-auto border-r border-edge">
            <div className="flex shrink-0 items-center gap-1 border-b border-edge px-3 py-2">
              {(["colour", "type", "shape", "components"] as const).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setTab(name)}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs capitalize transition",
                    tab === name ? "bg-accent text-accent-fg" : "text-content-muted hover:text-content",
                  )}
                >
                  {name}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-1 p-3">
              {tab === "colour" && (
                <>
                  <Row label="Mode" hint="Which way derived colours shift">
                    <VariantField
                      options={["light", "dark"] as const}
                      value={draft.mode}
                      onChange={(value) => setDraft((c) => ({ ...c, mode: value as "light" | "dark" }))}
                    />
                  </Row>
                  {COLOR_ROLES.map((role) => (
                    <Row key={role.key} label={role.label} hint={role.hint}>
                      <ColorField
                        value={draft.colors[role.key] ?? "#000000"}
                        onChange={(value) => set("colors", { [role.key]: value } as never)}
                      />
                    </Row>
                  ))}
                </>
              )}

              {tab === "type" && (
                <>
                  <Row label="Body face">
                    <VariantField
                      options={THEME_FONTS}
                      value={draft.type.fontBody}
                      onChange={(value) => set("type", { fontBody: value as never })}
                    />
                  </Row>
                  <Row label="Display face" hint="Headings and metrics">
                    <VariantField
                      options={THEME_FONTS}
                      value={draft.type.fontDisplay ?? draft.type.fontBody}
                      onChange={(value) => set("type", { fontDisplay: value as never })}
                    />
                  </Row>
                  <Row label="Body size">
                    <NumberField
                      value={draft.type.baseSize}
                      onChange={(value) => set("type", { baseSize: value })}
                      min={11}
                      max={20}
                      suffix="px"
                    />
                  </Row>
                  <Row label="Scale" hint="1.125 dense · 1.414 editorial">
                    <NumberField
                      value={draft.type.scaleRatio}
                      onChange={(value) => set("type", { scaleRatio: value })}
                      min={1.05}
                      max={1.7}
                      step={0.008}
                    />
                  </Row>
                  <Row label="Line height">
                    <NumberField
                      value={draft.type.lineHeight}
                      onChange={(value) => set("type", { lineHeight: value })}
                      min={1.1}
                      max={2}
                      step={0.05}
                    />
                  </Row>
                  <Row label="Heading weight">
                    <NumberField
                      value={draft.type.weightDisplay}
                      onChange={(value) => set("type", { weightDisplay: value })}
                      min={300}
                      max={900}
                      step={100}
                    />
                  </Row>
                  <Row label="Caps headings">
                    <input
                      type="checkbox"
                      checked={draft.type.uppercaseHeadings}
                      onChange={(event) => set("type", { uppercaseHeadings: event.target.checked })}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                  </Row>
                </>
              )}

              {tab === "shape" && (
                <>
                  <Row label="Space unit" hint="2px dense · 6px airy">
                    <NumberField
                      value={draft.space.unit}
                      onChange={(value) => set("space", { unit: value })}
                      min={1}
                      max={10}
                      suffix="px"
                    />
                  </Row>
                  <Row label="Row height">
                    <NumberField
                      value={draft.space.rowHeight}
                      onChange={(value) => set("space", { rowHeight: value })}
                      min={24}
                      max={72}
                      suffix="px"
                    />
                  </Row>
                  <Row label="Control height">
                    <NumberField
                      value={draft.space.controlHeight}
                      onChange={(value) => set("space", { controlHeight: value })}
                      min={24}
                      max={56}
                      suffix="px"
                    />
                  </Row>
                  <Row label="Corner radius">
                    <NumberField
                      value={draft.shape.radiusMd}
                      onChange={(value) =>
                        set("shape", {
                          radiusMd: value,
                          radiusSm: Math.max(0, Math.round(value * 0.66)),
                          radiusLg: Math.round(value * 1.6),
                        })
                      }
                      min={0}
                      max={24}
                      suffix="px"
                    />
                  </Row>
                  <Row label="Border width">
                    <NumberField
                      value={draft.shape.borderWidth}
                      onChange={(value) => set("shape", { borderWidth: value })}
                      min={0}
                      max={4}
                      suffix="px"
                    />
                  </Row>
                  <Row label="Shadow" hint="Flat and bordered, or soft and elevated">
                    <VariantField
                      options={SHADOW_STYLES}
                      value={draft.shadow.style}
                      onChange={(value) => set("shadow", { style: value as never })}
                    />
                  </Row>
                </>
              )}

              {tab === "components" && (
                <>
                  <Row label="Tables">
                    <VariantField
                      options={TABLE_VARIANTS}
                      value={draft.components.table}
                      onChange={(value) => set("components", { table: value as never })}
                    />
                  </Row>
                  <Row label="Cards">
                    <VariantField
                      options={CARD_VARIANTS}
                      value={draft.components.card}
                      onChange={(value) => set("components", { card: value as never })}
                    />
                  </Row>
                  <Row label="Buttons">
                    <VariantField
                      options={BUTTON_VARIANTS}
                      value={draft.components.button}
                      onChange={(value) => set("components", { button: value as never })}
                    />
                  </Row>
                  <Row label="Badges">
                    <VariantField
                      options={BADGE_VARIANTS}
                      value={draft.components.badge}
                      onChange={(value) => set("components", { badge: value as never })}
                    />
                  </Row>
                  <Row label="Tabs">
                    <VariantField
                      options={TABS_VARIANTS}
                      value={draft.components.tabs}
                      onChange={(value) => set("components", { tabs: value as never })}
                    />
                  </Row>
                  <Row label="Inputs">
                    <VariantField
                      options={INPUT_VARIANTS}
                      value={draft.components.input}
                      onChange={(value) => set("components", { input: value as never })}
                    />
                  </Row>
                </>
              )}
            </div>
          </div>

          {/* The preview is the real thing: the same variables, on real markup. */}
          <div className="min-w-0 flex-1 overflow-auto bg-surface-sunken p-4" style={preview}>
            <div className="flex flex-col gap-3 bg-surface p-4" style={{ borderRadius: "var(--radius-lg)" }}>
              <h1 className="font-display text-lg font-semibold text-content">Today</h1>
              <div className="grid grid-cols-3 gap-3">
                {[
                  ["Waiting", "12"],
                  ["In progress", "5"],
                  ["Done today", "28"],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-0.5 rounded border border-edge bg-surface-raised p-3 shadow-card">
                    <span className="text-sm text-content-muted">{label}</span>
                    <span className="font-display text-xl font-semibold tabular-nums text-content">{value}</span>
                  </div>
                ))}
              </div>
              <div className="overflow-hidden rounded border border-edge">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-surface-sunken">
                    <tr>
                      {["Name", "Status", "Updated"].map((head) => (
                        <th key={head} className="border-b border-edge px-3 py-2 text-left font-medium text-content-secondary">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Ada Lovelace", "Waiting"],
                      ["Grace Hopper", "In chair"],
                      ["Alan Turing", "Done"],
                    ].map(([name, status]) => (
                      <tr key={name} className="border-b border-edge last:border-0">
                        <td className="h-row px-3 text-content">{name}</td>
                        <td className="h-row px-3">
                          <span className="inline-flex items-center rounded-sm border border-edge px-2 text-xs leading-5 text-content-secondary">
                            {status}
                          </span>
                        </td>
                        <td className="h-row px-3 text-content-muted">2 min ago</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-control items-center rounded bg-accent px-3 text-sm text-accent-fg">
                  Add patient
                </span>
                <span className="inline-flex h-control items-center rounded border border-edge px-3 text-sm text-content">
                  Export
                </span>
              </div>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-edge px-4 py-3">
          <div className="min-w-0 flex-1">
            {problems.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-[var(--warning)]">
                <AlertTriangle size={12} className="mt-px shrink-0" />
                <span>{problems[0]}</span>
              </p>
            )}
            {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <Button type="button" variant="ghost" size="default" onClick={onClose} className="text-sm">
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="default"
              onClick={() => void save()}
              disabled={saving || problems.length > 0}
              className="text-sm"
            >
              {saving ? <ThinkingOrb state="working" size={20} theme="dark" aria-hidden="true" /> : null}
              {saving ? "Saving…" : "Save theme"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
