import { z } from "zod";

import { variableSpecSchema, type VariableSpec } from "../env/spec.ts";

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
 * Capabilities an app can declare a provider for in its own package.json
 * (`tulipes.providers`), in acquisition order. `settings` has a default
 * (core's file store) and is never something a module requires; the other
 * three a module can require, kept as an enum so a misspelt requirement is
 * a manifest error, not a silently unmet one.
 */
export const providerCapabilities = ["models", "settings", "queues", "sockets"] as const;
export type ProviderCapability = (typeof providerCapabilities)[number];

export const moduleRequirements = ["models", "queues", "sockets"] as const;
export type ModuleRequirement = (typeof moduleRequirements)[number];

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
    /**
     * This module's environment contract: the variables it owns. Boot
     * resolves them before anything else; `tulipes sync` types them and
     * writes `.env.example` from them. Only what the process needs before
     * the database answers, plus secrets — everything else is a setting
     * declared in module.config.ts.
     */
    env: z.array(variableSpecSchema).default([]),
    /**
     * Provider capabilities this module consumes without owning files that
     * imply them (`models/` implies "models", `queues/` "queues", `sockets/` "sockets").
     */
    requires: z.array(z.enum(moduleRequirements)).default([]),
  })
  .strict();

/**
 * A module's `@app/*` dependencies are its load-order dependencies: it
 * imports from them, so they load first. Written only for ordering without
 * an import.
 */
export function derivedDependsOn(packageName: string, declared: readonly string[], dependencies: Record<string, string> | undefined): string[] {
  const scope = packageName.startsWith("@") ? packageName.slice(0, packageName.indexOf("/") + 1) : undefined;
  const order = [...declared];
  if (scope) {
    for (const dependency of Object.keys(dependencies ?? {})) {
      if (!dependency.startsWith(scope) || dependency === packageName) continue;
      const short = dependency.slice(scope.length);
      if (!order.includes(short)) order.push(short);
    }
  }
  return order;
}

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
  requires: readonly ModuleRequirement[];
  env: readonly VariableSpec[];
}
