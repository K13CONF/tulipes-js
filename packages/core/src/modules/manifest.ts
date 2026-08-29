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
}
