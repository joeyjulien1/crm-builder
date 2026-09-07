import { normalizeAutomation } from "./schema";
import type { AutomationConfig, Config } from "./types";

/**
 * Fills in config keys that did not exist when a row was written.
 *
 * Configs are stored as JSONB and read back straight into a `Config`-typed
 * field without being re-parsed, so the type is a promise about the shape, not
 * a check of it. Every key added to the schema since a tenant last saved is
 * therefore missing at runtime while TypeScript insists it is there — and
 * `config.screens.forEach(...)` throws on a workspace that has simply not been
 * touched since screens shipped.
 *
 * This runs on every read from `lib/config/version.ts`. It is deliberately
 * total: it fills defaults and cannot throw. Validation is a separate job that
 * belongs on the write path, where a bad config should be rejected — failing a
 * read would take the whole workspace down over a key that has a sane default.
 *
 * When you add a top-level key to `configSchema` with a `.default()`, add it
 * here too. That is the whole maintenance burden, and forgetting it is a
 * runtime crash rather than a type error.
 */
export function hydrateConfig(raw: Config): Config {
  const config = raw as Partial<Config> | null | undefined;
  if (!config || typeof config !== "object") return raw;

  return {
    ...(config as Config),
    objects: config.objects ?? [],
    views: config.views ?? [],
    pipelines: config.pipelines ?? [],
    relations: config.relations ?? [],
    // Workflows written before steps existed are still `{conditions, actions}`
    // in JSONB. Reshape them here, on the one read path, rather than teaching
    // every consumer two shapes.
    automations: (config.automations ?? []).map((automation) => normalizeAutomation(automation) as AutomationConfig),
    screens: config.screens ?? [],
    customAgents: config.customAgents ?? [],
    // theme is left exactly as stored. lib/config/theme.ts fills the defaults
    // and upgrades a theme written against the old closed sets, because those
    // functions are called with configs from places other than this read path.
    theme: config.theme ?? ({} as Config["theme"]),
  };
}
