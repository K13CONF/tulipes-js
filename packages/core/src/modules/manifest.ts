import { z } from "zod";

/**
 * A module's ordering metadata lives under the "tulipes" key of its
 * package.json — never in the folder name — so reprioritizing a module can
 * never break the `dependsOn` references pointing at it.
 */

export const moduleTiers = [
  /** Framework-critical modules; always load before every "app" module. */
  "sys",
  "app",
] as const;

export type ModuleTier = (typeof moduleTiers)[number];

export const DEFAULT_PRIORITY = 100;

/**
 * Infrastructure a module can require from a provider the app declares in its
 * own package.json (`tulipes.providers`). Kept as an enum so a misspelt
 * requirement is a manifest error, not a silently unmet one.
 */
export const providerCapabilities = ["models", "queues"] as const;
export type ProviderCapability = (typeof providerCapabilities)[number];

/**
 * `.strict()` so a typo like "dependson" crashes boot instead of silently
 * loading the module with default ordering.
 */
export const tulipesManifestSchema = z
  .object({
    tier: z.enum(moduleTiers).default("app"),
    /** Lower loads earlier; tie-breaker inside a tier. */
    priority: z.number().int().default(DEFAULT_PRIORITY),
    /** Short names of modules that must load before this one. */
    dependsOn: z.array(z.string().min(1)).default([]),
    /** All route files use defineRoutes with infrastructure acquired through runtime(). */
    offline: z.boolean().optional(),
    /**
     * Provider capabilities this module consumes without owning files that
     * imply them (`models/` or `bootstrap/` imply "models", `queues/` implies "queues").
     */
    requires: z.array(z.enum(providerCapabilities)).default([]),
  })
  .strict();

export interface ModuleManifest {
  /**
   * Canonical short name — the last segment of the package name
   * (`@app/users` → `users`). This is what `dependsOn` references.
   */
  name: string;
  packageName: string;
  /** Absolute path to the module's folder. */
  dir: string;
  tier: ModuleTier;
  priority: number;
  dependsOn: readonly string[];
  offline?: boolean;
  requires: readonly ProviderCapability[];
}
