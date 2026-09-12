import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import { BootReport } from "../errors/boot-error.js";
import { providerCapabilities, type ProviderCapability } from "../modules/manifest.js";
import type { ModuleFiles } from "../modules/explorer.js";
import type { Cleanup } from "./cleanup.js";
import type { Ctx, ProviderCapabilities } from "./contracts.js";

/**
 * Infrastructure providers — the seam that lets core boot without owning a
 * database driver.
 *
 * The app selects a provider with one static line in its package.json:
 *
 *   "tulipes": { "providers": { "models": "@tulipes/mongoose" } }
 *
 * Static, because `sync`, offline `routes`/`spec` and `env:check` must learn
 * the selection without importing app code; capability-keyed, because it
 * makes "one provider per capability" true by construction and lets offline
 * tooling check module requirements against the keys alone. Installing a
 * provider package selects nothing; a leftover MONGO_URI selects nothing.
 */

/** What a provider hands to core the moment a resource exists. */
export interface AcquiredResource {
  dispose(): unknown | Promise<unknown>;
  /** Driver-specific forced teardown, run when dispose misses the deadline. */
  forceDispose?(): unknown | Promise<unknown>;
  /** Shown in the startup banner; must never contain credentials. */
  status(): ProviderStatus;
  /**
   * Worker mode only, after every provider is acquired: start consuming and
   * return how many consumers run. Core refuses a worker whose providers
   * together serve nothing.
   */
  serve?(report: BootReport): number | Promise<number>;
  /**
   * First shutdown phase, concurrently with the HTTP drain and module onDrain
   * hooks: stop long-lived consumption while everything a draining request
   * or job may still need — models, producers — stays available. Disposal
   * follows module onShutdown.
   */
  drain?(): unknown | Promise<unknown>;
}

export interface ProviderStatus {
  label: string;
  ready: boolean;
  /** Secondary banner text, e.g. "2 queue(s) · 1 processor(s)". */
  detail?: string;
}

/** What a provider is handed: the live boot context as it stands after ACL (phase 7). */
export interface ProviderContext {
  /** Read it, run bootstrap tasks against it; core alone assigns the capability slot. */
  ctx: Ctx;
  rootDir: string;
  /** Discovered files for every module in load order; the provider decides what to import. */
  files: readonly ModuleFiles[];
  /** false in script mode and runtime inspection — bootstrap is a serving process's job. */
  runBootstrap: boolean;
}

export interface Provider<Capability extends ProviderCapability = ProviderCapability> {
  /** Bumped when this interface changes incompatibly; core refuses others. */
  contract: 1;
  capability: Capability;
  /** Short name for the banner and diagnostics, e.g. "mongoose". */
  name: string;
  /**
   * Acquire the capability. Call `own()` synchronously after creating any
   * resource and BEFORE awaiting anything that can fail or hang, so a failed
   * acquisition is still disposed by core. Report failures through `report`
   * and return undefined; a thrown error is reported too, but less precisely.
   */
  acquire(
    ctx: ProviderContext,
    report: BootReport,
    own: (resource: AcquiredResource) => void,
  ): Promise<ProviderCapabilities[Capability] | undefined>;
}

export const PROVIDER_CONTRACT = 1;

/** `tulipes.providers` of the app's package.json: capability → module specifier. */
export type ProviderDeclarations = Partial<Record<ProviderCapability, string>>;

const declarationSchema = z
  .object({
    providers: z
      .object(Object.fromEntries(providerCapabilities.map((c) => [c, z.string().min(1).optional()])))
      .strict()
      .optional(),
  })
  // Only `providers` is core's; an app may keep other keys under `tulipes`.
  .passthrough();

/** Read the declaration without importing anything. Safe for offline tooling. */
export function readProviderDeclarations(rootDir: string, report: BootReport): ProviderDeclarations {
  let json: { tulipes?: unknown };
  try {
    json = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as { tulipes?: unknown };
  } catch (error) {
    report.add({ scope: "providers", message: `package.json missing or invalid: ${(error as Error).message}` });
    return {};
  }
  if (json.tulipes === undefined) return {};
  const parsed = declarationSchema.safeParse(json.tulipes);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      report.add({
        scope: "providers",
        message: `package.json "tulipes" key: ${issue.path.join(".") || "(root)"} — ${issue.message}`,
      });
    }
    return {};
  }
  return (parsed.data.providers ?? {}) as ProviderDeclarations;
}

/** Explicit `requires` plus what a module's files imply. */
export function effectiveRequirements(files: ModuleFiles): ProviderCapability[] {
  const required = new Set<ProviderCapability>(files.module.requires);
  if (files.modelFiles.length > 0 || files.bootstrapFiles.length > 0) required.add("models");
  if (files.queueFiles.length > 0) required.add("queues");
  return [...required];
}

/**
 * Refuse before any module code is imported: a module that needs models in
 * an app that declares no provider must not get as far as importing a schema.
 */
export function checkRequirements(
  explored: readonly ModuleFiles[],
  declared: ProviderDeclarations,
  report: BootReport,
): void {
  for (const files of explored) {
    for (const capability of effectiveRequirements(files)) {
      if (declared[capability]) continue;
      const why = files.module.requires.includes(capability)
        ? "declares it in tulipes.requires"
        : `has ${capability === "queues" ? "queues/" : files.modelFiles.length ? "models/" : "bootstrap/"} files`;
      report.add({
        scope: "providers",
        module: files.module.name,
        message: `requires capability "${capability}" (${why}) but the app's package.json declares no provider for it — add "tulipes": { "providers": { "${capability}": "<package>" } }`,
      });
    }
  }
}

export interface AcquiredProvider {
  capability: ProviderCapability;
  provider: string;
  resource?: AcquiredResource;
}

/**
 * Phase 8. Import each declared provider from the app (never from wherever
 * core itself lives), validate its shape, acquire, and hand the value to ctx.
 * Every resource a provider registered through `own()` is returned so the
 * caller can dispose it — on success and on failure alike.
 */
export async function acquireProviders(
  declared: ProviderDeclarations,
  context: ProviderContext,
  report: BootReport,
): Promise<AcquiredProvider[]> {
  const acquired: AcquiredProvider[] = [];
  const requireFromApp = createRequire(join(context.rootDir, "package.json"));

  for (const capability of providerCapabilities) {
    const specifier = declared[capability];
    if (!specifier) continue;

    const entry: AcquiredProvider = { capability, provider: specifier };
    acquired.push(entry);

    let provider: Provider;
    try {
      const resolved = requireFromApp.resolve(specifier);
      const exported = (await import(pathToFileURL(resolved).href)) as { default?: unknown };
      provider = validateProvider(exported.default, capability, specifier);
    } catch (error) {
      report.add({
        scope: "providers",
        message: `provider "${specifier}" for capability "${capability}" ${
          (error as { code?: string }).code === "MODULE_NOT_FOUND"
            ? `cannot be resolved from ${context.rootDir} — install it`
            : `failed to load: ${(error as Error).message}`
        }`,
      });
      continue;
    }
    entry.provider = provider.name;

    const own = (resource: AcquiredResource): void => {
      if (entry.resource) {
        report.add({ scope: "providers", message: `provider "${provider.name}" called own() twice — one resource per acquisition` });
        return;
      }
      entry.resource = resource;
    };

    const issuesBefore = report.issues.length;
    try {
      const value = await provider.acquire(context, report, own);
      if (value !== undefined) (context.ctx as Record<ProviderCapability, unknown>)[capability] = value;
      else if (report.issues.length === issuesBefore) {
        report.add({ scope: "providers", message: `provider "${provider.name}" returned nothing without reporting why` });
      }
    } catch (error) {
      report.add({
        scope: "providers",
        message: `provider "${provider.name}" threw during acquisition: ${(error as Error).message}`,
      });
    }
  }

  return acquired;
}

function validateProvider(value: unknown, capability: ProviderCapability, specifier: string): Provider {
  const candidate = value as Partial<Provider> | undefined;
  if (typeof candidate?.acquire !== "function" || typeof candidate.name !== "string") {
    throw new Error(`${specifier} must default-export a provider { contract, capability, name, acquire }`);
  }
  if (candidate.contract !== PROVIDER_CONTRACT) {
    throw new Error(`${specifier} implements provider contract ${String(candidate.contract)}; this core supports ${PROVIDER_CONTRACT} — upgrade one of them`);
  }
  if (candidate.capability !== capability) {
    throw new Error(`${specifier} provides capability "${String(candidate.capability)}" but is declared for "${capability}"`);
  }
  return candidate as Provider;
}

/** Worker mode: every provider that can serve does; the total decides whether the worker may run. */
export async function serveProviders(acquired: readonly AcquiredProvider[], report: BootReport): Promise<number> {
  let consumers = 0;
  for (const { resource } of acquired) if (resource?.serve) consumers += await resource.serve(report);
  return consumers;
}

/** Drain phase: stop consumption while dependencies remain; run concurrently by the caller. */
export function drainProviders(acquired: readonly AcquiredProvider[], cleanup: Cleanup): Promise<void>[] {
  return acquired.flatMap(({ provider, resource }) =>
    resource?.drain ? [cleanup.run(`provider ${provider} drain`, () => resource.drain!())] : []);
}

/** Reverse acquisition order, each under the shared deadline with its forced path. */
export async function disposeProviders(acquired: readonly AcquiredProvider[], cleanup: Cleanup): Promise<void> {
  for (const { provider, resource } of [...acquired].reverse()) {
    if (!resource) continue;
    await cleanup.run(`provider ${provider}`, () => resource.dispose(), resource.forceDispose && (() => resource.forceDispose!()));
  }
}

export interface AcquiredStatus extends ProviderStatus {
  capability: string;
  provider: string;
}

/** Banner rows; safe to call before or after acquisition. */
export function providerStatuses(acquired: readonly AcquiredProvider[]): AcquiredStatus[] {
  return acquired.map(({ capability, provider, resource }) => {
    const status = resource?.status() ?? { label: "not acquired", ready: false };
    return { capability, provider, ...status };
  });
}
