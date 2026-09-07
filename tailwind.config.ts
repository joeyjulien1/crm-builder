import type { Config } from "tailwindcss";

/**
 * Utilities resolve to the semantic layer in app/globals.css. A component that
 * reaches past these to a raw ramp value is a bug — see docs/DESIGN.md.
 */
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],

  /**
   * Screens the agent writes as code live in the database, not in the files
   * above, so Tailwind cannot see their classes and would purge every one of
   * them. The kit in `components/generated/kit.tsx` carries most of the styling
   * for exactly this reason; this covers the layout and typography a screen
   * reasonably reaches for on top of it.
   *
   * Keep it a list, not a pattern over the whole colour space: everything here
   * ships to every user, and the semantic palette is deliberately small.
   */
  safelist: [
    { pattern: /^(flex|grid|hidden|block|inline-flex|contents)$/ },
    { pattern: /^(flex-(row|col|wrap|nowrap|1|none|auto)|grow|shrink|shrink-0)$/ },
    { pattern: /^grid-cols-(1|2|3|4|5|6|12)$/, variants: ["sm", "md", "lg"] },
    { pattern: /^col-span-(1|2|3|4|5|6|full)$/, variants: ["sm", "md", "lg"] },
    { pattern: /^(items|justify|self|content)-(start|center|end|between|around|stretch|baseline)$/ },
    { pattern: /^(gap|gap-x|gap-y)-(0|1|2|3|4|5|6)$/ },
    { pattern: /^(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml)-(0|1|2|3|4|5|6|auto)$/ },
    { pattern: /^(w|h|min-w|min-h|max-w|max-h)-(full|screen|fit|min|max|auto|0|control|row)$/ },
    { pattern: /^max-w-(xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|prose)$/ },
    { pattern: /^overflow(-x|-y)?-(auto|hidden|visible|scroll)$/ },
    { pattern: /^(relative|absolute|sticky|fixed|top-0|right-0|bottom-0|left-0|z-10|z-20)$/ },
    { pattern: /^text-(xs|sm|base|lg|xl|2xl|left|center|right)$/ },
    { pattern: /^font-(sans|display|mono|normal|medium|semibold|bold)$/ },
    { pattern: /^(uppercase|capitalize|truncate|tabular-nums|italic|underline|whitespace-nowrap)$/ },
    { pattern: /^text-(content|content-secondary|content-muted|content-accent|accent|accent-fg|danger|success|warning)$/ },
    { pattern: /^bg-(surface|surface-sunken|surface-raised|surface-hover|accent|accent-subtle|transparent)$/ },
    { pattern: /^border(-t|-r|-b|-l)?(-0|-2)?$/ },
    { pattern: /^border-(edge|edge-strong|accent|danger|success|warning|transparent)$/ },
    { pattern: /^rounded(-sm|-lg|-full|-none)?$/ },
    { pattern: /^shadow-(card|panel|overlay|none)$/ },
    { pattern: /^(opacity-(50|60|70|80|90)|cursor-pointer|select-none|animate-pulse|sr-only)$/ },
    { pattern: /^hover:(bg-surface-hover|bg-accent-hover|text-content|underline)$/ },
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "var(--surface)",
          sunken: "var(--surface-sunken)",
          raised: "var(--surface-raised)",
          hover: "var(--surface-hover)",
        },
        content: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          accent: "var(--text-accent)",
        },
        edge: {
          DEFAULT: "var(--border-subtle)",
          strong: "var(--border-strong)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          fg: "var(--accent-fg)",
          subtle: "var(--accent-subtle)",
        },
        danger: "var(--danger)",
        success: "var(--success)",
        warning: "var(--warning)",
      },
      spacing: {
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        5: "var(--space-5)",
        6: "var(--space-6)",
      },
      fontSize: {
        xs: ["var(--text-xs)", { lineHeight: "var(--line-body)" }],
        sm: ["var(--text-sm)", { lineHeight: "var(--line-body)" }],
        base: ["var(--text-base)", { lineHeight: "var(--line-body)" }],
        lg: ["var(--text-lg)", { lineHeight: "1.25" }],
        xl: ["var(--text-xl)", { lineHeight: "1.15" }],
        "2xl": ["var(--text-2xl)", { lineHeight: "1.05" }],
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      fontWeight: {
        body: "var(--weight-body)",
        display: "var(--weight-display)",
      },
      letterSpacing: {
        theme: "var(--tracking)",
      },
      borderWidth: {
        DEFAULT: "var(--border-width)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        panel: "var(--shadow-panel)",
        overlay: "var(--shadow-overlay)",
      },
      outlineWidth: {
        focus: "var(--focus-width)",
      },
      outlineOffset: {
        focus: "var(--focus-offset)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        lg: "var(--radius-lg)",
      },
      height: {
        control: "var(--control-h)",
        row: "var(--row-h)",
      },
      minHeight: {
        control: "var(--control-h)",
        row: "var(--row-h)",
      },
      width: {
        control: "var(--control-h)",
        row: "var(--row-h)",
      },
      transitionTimingFunction: {
        DEFAULT: "var(--ease)",
      },
      transitionDuration: {
        fast: "var(--dur-fast)",
        DEFAULT: "var(--dur)",
      },
    },
  },
  plugins: [],
};

export default config;
