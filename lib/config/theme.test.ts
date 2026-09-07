import { describe, expect, it } from "vitest";
import { defaultConfig } from "./default";
import { applyPatch, applyPatches, parsePatch, PatchError, validateConfig } from "./patch";
import {
  assertReadable,
  contrastRatio,
  describeTheme,
  resolveTheme,
  rowHeightOf,
  themeAttributes,
  themeVars,
} from "./theme";
import type { Config } from "./types";

const base = defaultConfig();

describe("the theme patch", () => {
  it("gives every tenant a theme, even one stored before themes existed", () => {
    expect(base.theme.colors.surface).toBeTruthy();
    expect(base.theme.components.table).toBe("bordered");

    // The read path takes config straight from JSONB without re-parsing, so the
    // renderers have to cope with the key being absent entirely.
    const legacy = { ...base } as Partial<Config>;
    delete legacy.theme;

    expect(() => themeVars(legacy.theme)).not.toThrow();
    expect(themeAttributes(legacy.theme)).toEqual({ "data-theme": "dark", "data-density": "app" });
  });

  it("merges one level down, so setting a colour keeps the other thirteen", () => {
    const teal = applyPatches(base, [{ op: "update_theme", theme: { colors: { accent: "#0d9488" } } }]);

    expect(teal.theme.colors.accent).toBe("#0d9488");
    expect(teal.theme.colors.surface).toBe(base.theme.colors.surface);
    expect(teal.theme.colors.textPrimary).toBe(base.theme.colors.textPrimary);
    expect(teal.theme.type.baseSize).toBe(base.theme.type.baseSize);

    const typed = applyPatches(teal, [{ op: "update_theme", theme: { type: { baseSize: 15 } } }]);
    expect(typed.theme.type.baseSize).toBe(15);
    expect(typed.theme.colors.accent).toBe("#0d9488");
    expect(typed.theme.type.scaleRatio).toBe(base.theme.type.scaleRatio);
  });

  it("refuses a colour that is not a hex value", () => {
    expect(() => parsePatch({ op: "update_theme", theme: { colors: { accent: "teal" } } })).toThrow(PatchError);
    expect(() => parsePatch({ op: "update_theme", theme: { colors: { accent: "#0d9488" } } })).not.toThrow();
  });

  it("keeps the scales inside liveable bounds", () => {
    expect(() => parsePatch({ op: "update_theme", theme: { type: { baseSize: 400 } } })).toThrow(PatchError);
    expect(() => parsePatch({ op: "update_theme", theme: { space: { unit: 90 } } })).toThrow(PatchError);
    expect(() => parsePatch({ op: "update_theme", theme: { shadow: { style: "dramatic" } } })).toThrow(PatchError);
    expect(() => parsePatch({ op: "update_theme", theme: { components: { table: "fancy" } } })).toThrow(PatchError);
  });

  it("round-trips through a rollback", () => {
    const before = validateConfig(base);
    const after = applyPatches(before, [
      {
        op: "update_theme",
        theme: {
          mode: "light",
          colors: { surface: "#fffdf7", textPrimary: "#1a1208", accent: "#b45309" },
          components: { table: "flush", card: "elevated" },
        },
      },
    ]);
    expect(after.theme).not.toEqual(before.theme);

    const restored = applyPatch(after, { op: "rollback", toVersion: 1, config: before });
    expect(restored.theme).toEqual(before.theme);
  });
});

describe("readability, which replaced the closed ramp list", () => {
  it("passes a palette with real contrast", () => {
    expect(assertReadable(resolveTheme(base.theme))).toEqual([]);
  });

  it("catches grey text on a grey background", () => {
    const problems = assertReadable(
      resolveTheme({ colors: { surface: "#3a3a3a", textPrimary: "#4a4a4a", raised: "#3a3a3a" } }),
    );
    expect(problems.join(" ")).toContain("Body text");
  });

  it("catches an accent nobody can read a label on", () => {
    // A mid-yellow: white fails on it, so the derived foreground must go dark.
    const readable = resolveTheme({ colors: { accent: "#fde047" } });
    expect(themeVars(readable)["--accent-fg"]).toBe("#111111");
    expect(assertReadable(readable)).toEqual([]);
  });

  it("catches invisible borders and a flat, depthless palette", () => {
    const problems = assertReadable(
      resolveTheme({ colors: { surface: "#101013", sunken: "#101013", raised: "#101013", borderSubtle: "#101013" } }),
    );
    expect(problems.join(" ")).toContain("Borders are invisible");
    expect(problems.join(" ")).toContain("nothing has depth");
  });

  it("computes WCAG contrast, not an approximation", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 1);
  });
});

describe("generated scales", () => {
  it("derives every type size from the base and the ratio", () => {
    const tight = themeVars({ type: { baseSize: 12, scaleRatio: 1.125 } });
    const loose = themeVars({ type: { baseSize: 16, scaleRatio: 1.414 } });

    expect(tight["--text-base"]).toBe("12px");
    expect(loose["--text-base"]).toBe("16px");

    // A magazine ratio pulls the headings much further from the body text.
    const tightSpread = parseFloat(tight["--text-2xl"]!) - parseFloat(tight["--text-base"]!);
    const looseSpread = parseFloat(loose["--text-2xl"]!) - parseFloat(loose["--text-base"]!);
    expect(looseSpread).toBeGreaterThan(tightSpread * 2);
  });

  it("derives the spacing scale from one unit", () => {
    const dense = themeVars({ space: { unit: 2 } });
    const airy = themeVars({ space: { unit: 6 } });
    expect(parseFloat(airy["--space-1"]!)).toBeGreaterThan(parseFloat(dense["--space-1"]!));
    expect(parseFloat(airy["--space-6"]!)).toBeGreaterThan(parseFloat(dense["--space-6"]!));
  });

  it("emits shadows only when the theme asks for them", () => {
    expect(themeVars({ shadow: { style: "none" } })["--shadow-card"]).toBe("none");
    expect(themeVars({ shadow: { style: "strong" } })["--shadow-card"]).toContain("rgba");
  });

  it("hands the table virtualiser a number that matches the CSS", () => {
    const theme = { space: { rowHeight: 48 } };
    expect(rowHeightOf(theme)).toBe(48);
    expect(themeVars(theme)["--row-h"]).toBe("48px");
  });
});

describe("upgrading a theme written against the old closed sets", () => {
  const legacy = {
    mode: "light",
    accent: "#0d9488",
    neutral: "stone",
    radius: "large",
    density: "comfortable",
    font: "serif",
  } as never;

  it("keeps an existing workspace looking exactly as it did", () => {
    const upgraded = resolveTheme(legacy);

    // The stone light ramp, not the dark default.
    expect(upgraded.colors.surface).toBe("#ffffff");
    expect(upgraded.colors.textPrimary).toBe("#1c1917");
    expect(upgraded.colors.accent).toBe("#0d9488");
    expect(upgraded.shape.radiusMd).toBe(10);
    expect(upgraded.space.rowHeight).toBe(44);
    // The old "serif" is now a real face, not a system stack.
    expect(upgraded.type.fontBody).toBe("lora");
    expect(upgraded.mode).toBe("light");
  });

  it("leaves an already-upgraded theme alone", () => {
    const modern = resolveTheme({ colors: { accent: "#ff0000" } });
    expect(modern.colors.accent).toBe("#ff0000");
    expect(modern.colors.surface).toBe("#101013");
  });

  it("produces a readable palette from every legacy combination", () => {
    for (const neutral of ["zinc", "slate", "stone", "gray"]) {
      for (const mode of ["light", "dark"]) {
        const problems = assertReadable(resolveTheme({ mode, neutral, accent: "#4f63b5" } as never));
        expect(problems, `${neutral}/${mode}`).toEqual([]);
      }
    }
  });
});

describe("describing a theme", () => {
  it("says what a person would notice", () => {
    const described = describeTheme({
      mode: "light",
      colors: { accent: "#0d9488" },
      components: { table: "flush", card: "elevated" },
    });
    expect(described).toContain("light");
    expect(described).toContain("#0d9488");
    expect(described).toContain("flush tables");
    expect(described).toContain("elevated cards");
  });
});
