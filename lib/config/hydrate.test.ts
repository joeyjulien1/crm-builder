import { describe, expect, it } from "vitest";
import { defaultConfig } from "./default";
import { hydrateConfig } from "./hydrate";
import { systemPrompt } from "@/lib/agent/prompt";
import { describeTrigger, hasBuiltBackend, screenSummary } from "@/components/backend/describe";
import { themeVars } from "./theme";
import type { Config } from "./types";

/**
 * A config saved before a key existed still has to load. Configs live in JSONB
 * and are read back without being re-parsed, so the `Config` type is a promise
 * about their shape rather than a check of it — every optional-with-default key
 * added to the schema is missing on rows written before it shipped.
 *
 * This is the shape of a workspace that has not been touched since screens and
 * themes landed.
 */
function legacyConfig(): Config {
  const config = structuredClone(defaultConfig()) as Partial<Config>;
  delete config.screens;
  delete config.theme;
  delete config.customAgents;
  delete config.automations;
  return config as Config;
}

const counts = { contact: 4, company: 2, deal: 1, activity: 0 };

describe("loading a config written before a key existed", () => {
  it("fills the missing keys rather than trusting the type", () => {
    const hydrated = hydrateConfig(legacyConfig());

    expect(hydrated.screens).toEqual([]);
    expect(hydrated.customAgents).toEqual([]);
    expect(hydrated.automations).toEqual([]);
    // hydrate leaves theme as stored; theme.ts fills the tokens.
    expect(() => themeVars(hydrated.theme)).not.toThrow();
    expect(themeVars(hydrated.theme)["--surface"]).toBeTruthy();
  });

  it("keeps what is already there", () => {
    const current = defaultConfig();
    const hydrated = hydrateConfig(current);

    expect(hydrated.objects).toEqual(current.objects);
    expect(hydrated.views).toEqual(current.views);
    expect(hydrated.theme).toEqual(current.theme);
  });

  it("never throws, whatever it is handed", () => {
    expect(() => hydrateConfig(undefined as unknown as Config)).not.toThrow();
    expect(() => hydrateConfig(null as unknown as Config)).not.toThrow();
    expect(() => hydrateConfig({} as Config)).not.toThrow();
  });

  /**
   * These three are where the missing key actually surfaced: the backend
   * crashed the whole app shell on `config.screens.forEach`.
   */
  it("does not crash the backend editor's describers", () => {
    for (const config of [legacyConfig(), hydrateConfig(legacyConfig())]) {
      expect(() => hasBuiltBackend(config)).not.toThrow();
      expect(() => config.automations?.map((a) => describeTrigger(a, config))).not.toThrow();
      expect(() => config.screens?.map(screenSummary)).not.toThrow();
    }
  });

  it("does not crash the agent's system prompt", () => {
    expect(() => systemPrompt(legacyConfig(), counts)).not.toThrow();
    expect(systemPrompt(hydrateConfig(legacyConfig()), counts)).toContain("Screens");
  });

  it("does not crash theme resolution", () => {
    expect(() => themeVars(legacyConfig().theme)).not.toThrow();
  });
});
