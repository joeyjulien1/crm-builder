# Design

One brand, two densities. The marketing site and the app share colour, type family, radius,
border weight, and motion. They do not share spacing or type scale.

Replace the placeholder values below with your derived Overflow tokens. Everything else in this
file is structural and stays.

## Brand layer — shared

```css
:root {
  /* colour — replace with your ramp */
  --brand-50:  #f4f6fb;
  --brand-100: #e4e9f5;
  --brand-300: #a9b6dc;
  --brand-500: #4f63b5;   /* accent */
  --brand-700: #33417a;
  --brand-900: #1b2246;

  --neutral-0:   #ffffff;
  --neutral-50:  #fafafa;
  --neutral-100: #f2f2f3;
  --neutral-200: #e6e6e8;
  --neutral-400: #a1a1a8;
  --neutral-600: #62626a;
  --neutral-900: #18181b;

  --danger:  #b4342f;
  --success: #1d7a52;
  --warning: #9a6510;

  /* type family */
  --font-sans: <derived>, ui-sans-serif, system-ui, sans-serif;
  --font-mono: <derived>, ui-monospace, monospace;

  /* form */
  --radius-sm: 4px;
  --radius:    6px;
  --radius-lg: 10px;
  --border-width: 1px;
  --border: var(--neutral-200);

  /* motion */
  --ease: cubic-bezier(0.2, 0, 0, 1);
  --dur-fast: 120ms;
  --dur:      180ms;
}
```

## Density layer — forked

```css
/* marketing site */
[data-density="site"] {
  --space-1: 8px;  --space-2: 16px; --space-3: 24px;
  --space-4: 40px; --space-5: 64px; --space-6: 96px;

  --text-xs: 14px; --text-sm: 16px; --text-base: 18px;
  --text-lg: 28px; --text-xl: 40px; --text-2xl: 56px;

  --line-body: 1.6;
  --control-h: 44px;
}

/* the app */
[data-density="app"] {
  --space-1: 2px;  --space-2: 4px;  --space-3: 8px;
  --space-4: 12px; --space-5: 16px; --space-6: 24px;

  --text-xs: 11px; --text-sm: 12px; --text-base: 13px;
  --text-lg: 16px; --text-xl: 20px; --text-2xl: 24px;

  --line-body: 1.45;
  --control-h: 30px;
  --row-h: 34px;
}
```

Set `data-density` once on the layout root of each route group. Nothing below that line should
reference a raw px value.

**A portal must be given its density container.** These variables live on the `[data-density]`
element so two route groups can differ, which means a component portalled to `document.body` is
outside all of them. Colours are on `:root` and keep working, so the failure looks like a styling
bug rather than a missing variable.

Two things guard against it. `:root` carries the site scale as a floor, so nothing is ever unstyled
— an escaped portal degrades to the larger, safer scale rather than to a browser default. And a
portalling component resolves its container from its trigger (`element.closest("[data-density]")`)
rather than defaulting to the body, which keeps both the escape from `overflow` clipping and the
right scale. `components/ui/popover.tsx` is the worked example; a dialog or tooltip should do the
same.

## Semantic layer

Components reference these, never the raw ramp. Changing the brand should require editing only
the block above.

```css
--surface:        var(--neutral-0);
--surface-sunken: var(--neutral-50);
--surface-raised: var(--neutral-0);
--surface-hover:  var(--neutral-100);

--text-primary:   var(--neutral-900);
--text-secondary: var(--neutral-600);
--text-muted:     var(--neutral-400);
--text-accent:    var(--brand-700);

--border-subtle:  var(--neutral-200);
--border-strong:  var(--neutral-400);
--focus-ring:     var(--brand-500);
```

Dark mode is a second block overriding the semantic layer only. Never override the ramp.

## Tenant themes

Each tenant sets its own reading of the semantic layer, and both the agent
(`set_theme`) and the theme editor write the same config. `lib/config/theme.ts`
maps `config.theme` onto the variables above and `app/(app)/layout.tsx` applies
it as the server-rendered fallback. `AppShell` narrows that theme to the
frontend preview. Studio navigation, the agent workspace, and Backend use the
fixed product tokens, so a customer's CRM palette never recolours its editor.
The generated CRM and Backend also reuse the same `ProjectIdentity` and `Button`
primitives. Their palette boundaries differ, but their typography, control
behaviour, focus treatment, and action motion stay recognisably one product.

This began as four grey ramps and five radii, on the reasoning that a tenant who
can set every colour can make a CRM nobody can read. That was true, and it
produced a worse problem: two workspaces differed in six scalars, the four ramps
were near-identical, and every generated CRM looked the same. **The sets are open
now and the guarantee moved.**

- **Variety comes from generation.** The agent designs a palette for the
  customer — a base hue for the trade, surfaces derived from it at controlled
  lightness steps — rather than choosing from a list.
- **Safety comes from validation.** `assertReadable` checks WCAG contrast when a
  theme is staged: 4.5:1 for body text, 4:1 for text on the accent, plus checks
  that borders are visible and that surface, sunken and raised are not the same
  colour. A failing palette comes back naming the offending pair. The theme
  editor shows the same warning live and refuses to save on it.
- **Identity is mostly not colour.** `theme.components` picks the variant for
  tables, cards, buttons, badges, tabs and inputs. A flush table on elevated
  cards with pill buttons has no visual relationship to a bordered table on
  outlined cards, without a single node in the tree changing.

Scales are generated, not enumerated: the type sizes step off `baseSize` by
`scaleRatio`, and the spacing scale off `space.unit` by its ratio. Six webfonts
load through `next/font` in `app/layout.tsx` — self-hosted, so a theme change
never waits on a network request.

Configs written before the theme existed have no `theme` key and are read from
JSONB without being re-parsed, and configs written against the old closed sets
are upgraded by `upgradeLegacyTheme` into the equivalent tokens so an existing
workspace looks exactly as it did. Do not remove either path.

This is styling only. A theme cannot add a screen, move a panel, or introduce a
component — the vocabulary in `docs/COMPONENTS.md` is still the ceiling.

## Rules for the app

**Density is the point.** A table row is 34px. If a design decision would show fewer than about
20 rows above the fold on a 900px viewport, it's wrong for this product.

**Borders over shadows.** Elevation in a dense UI reads as noise. Use `--border-subtle` for
separation. Shadows are for genuinely floating things only: popovers, dialogs, drag previews.

**One accent.** The brand colour marks the primary action and the selected state. Not headings,
not icons, not links inside body text. If everything is accented, nothing is.

**Status uses colour plus a second cue.** A stage pill, a validation error, a sync failure — all
carry an icon or a text label alongside the colour, so they survive colourblindness and
greyscale printing.

**Motion answers actions only.** Panel open, row expand, toast enter, drag settle. No entrance
animations on page load, no hover transitions on table rows beyond a background change.

**Focus is always visible.** 2px `--focus-ring` at 2px offset. A CRM is a keyboard product —
people live in it eight hours a day and will learn the shortcuts.

## Rules for the site

Follow the Overflow analysis for layout, hero treatment, and section rhythm. Two constraints
regardless: line length under 80 characters, and the hero shows the product doing the thing —
a real config diff, a real board — rather than an abstract illustration. You're selling
"it configures itself", so show it configuring itself.

## Anti-patterns

Do not ship: all-caps tracked-out eyebrow labels above headings, identical rounded cards with
the same soft grey shadow chopping every section, gradient washes as decoration, arrows
appended to button text, one accented word in a headline, or numbered markers on content that
isn't a sequence. These are the defaults every generated SaaS page arrives at, and they'll make
a product with a genuinely novel mechanic look like everything else.
