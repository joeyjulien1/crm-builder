/**
 * The studio's own chrome.
 *
 * These are the surfaces, borders and controls the frontend tab
 * (`BlankStudioCanvas`) established: a zinc-on-near-black language with soft
 * `rounded-xl` cards and quiet outline buttons. Backend draws from the same
 * tokens so the two tabs read as one product rather than two — before this,
 * Backend rendered against the tenant theme's accent and shipped a purple
 * primary button the frontend never uses.
 *
 * Studio chrome is product UI, not tenant output: nothing here resolves to a
 * customer's theme variables, and editing a theme must not recolour it.
 */

/** Page and column surfaces. */
export const studioSurface = {
  /** The canvas behind everything. */
  root: "bg-[#09090b] text-zinc-100",
  /** Side rails and headers, one step darker than the canvas. */
  rail: "bg-[#0c0c0e]",
  /** The card fill used for every list row, stat and panel. */
  card: "bg-[#131316]",
  border: "border-zinc-800/80",
} as const;

/** A resting card. Add `studioCardInteractive` when the whole card is a button. */
export const studioCard = "rounded-xl border border-zinc-800/90 bg-[#131316] shadow-sm";

export const studioCardInteractive =
  "transition-all hover:border-zinc-700 hover:bg-zinc-900/80";

/** The small mono label above a group — "Navigation", "Recent generations". */
export const studioEyebrow =
  "text-[10px] font-mono font-medium uppercase tracking-wider text-zinc-500";

/** Sidebar navigation. */
export const studioNavItem =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors";
export const studioNavItemActive = "bg-zinc-800/90 font-semibold text-white shadow-sm";
export const studioNavItemIdle = "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200";

/**
 * Buttons. The studio has no filled accent button — weight comes from the
 * border, matching `docs/DESIGN.md` on elevation.
 */
export const studioButtonPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40";

export const studioButtonSecondary =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-[#18181c] px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white disabled:pointer-events-none disabled:opacity-40";

export const studioButtonGhost =
  "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-900/60 hover:text-zinc-200";

export const studioInput =
  "w-full rounded-lg border border-zinc-800 bg-[#131316] py-1.5 pl-8 pr-3 text-xs text-zinc-200 transition-colors placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none";

/** The square icon that leads a list row or a step. */
export const studioIconChip =
  "flex shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400";

/** Inline error, as the frontend renders one. */
export const studioError =
  "rounded-xl border border-red-900/50 bg-red-950/40 p-2.5 text-xs text-red-400";

/** Status pills, borrowed from the agent panel's model badge. */
export const studioPillOn =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-800/50 bg-emerald-950/70 px-2 py-0.5 text-[10px] font-mono text-emerald-400";
export const studioPillOff =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/70 px-2 py-0.5 text-[10px] font-mono text-zinc-500";

/** Page titles and their supporting line. */
export const studioTitle = "text-2xl font-semibold tracking-tight text-white";
export const studioSubtitle = "text-sm leading-relaxed text-zinc-400";
