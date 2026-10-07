import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { boot as bundledBoot } from "@tulipes/core/boot";
import type { BootHandle, BootOptions } from "@tulipes/core/boot";

export type BootFn = (options: BootOptions) => Promise<BootHandle>;

/**
 * Resolves a module **from the app**, not from wherever this CLI lives.
 *
 * `tulipes` is normally installed globally, so a bare `import(...)` inside
 * the CLI resolves against the CLI's own node_modules. For anything the
 * app also depends on, that yields a *second* copy — and two copies of a
 * library that uses `instanceof` do not recognise each other's objects.
 */
export async function importFromApp<T>(rootDir: string, specifier: string): Promise<T | undefined> {
  try {
    // Anchored on the app's package.json so resolution starts in the app,
    // whatever directory the CLI itself was installed into.
    const requireFromApp = createRequire(join(rootDir, "package.json"));
    const entry = requireFromApp.resolve(specifier);
    return (await import(pathToFileURL(entry).href)) as T;
  } catch {
    return undefined;
  }
}

/**
 * The `boot` belonging to the app, falling back to this CLI's own.
 *
 * Booting through the app's own `@tulipes/core` is what keeps every shared
 * singleton to ONE copy, and what makes the app's
 * declared providers (`tulipes.providers`) resolve from the app rather than
 * from wherever the CLI happens to be installed.
 *
 * The fallback covers an app with no local install, where the CLI's copy
 * is the only one there is. A version skew between the two is reported by
 * `tulipes -v`.
 */
export async function appBoot(rootDir: string): Promise<BootFn> {
  const module = await importFromApp<{ boot?: BootFn }>(rootDir, "@tulipes/core/boot");
  return module?.boot ?? bundledBoot;
}

/**
 * An app's modules are TypeScript and the CLI imports them as they are:
 * Node strips the types natively (every supported Node does), so there is
 * no loader to register. What this checks is that the node running the
 * CLI is one of those — a node too old to strip types would fail later,
 * on the first module file, with a syntax error that says nothing about
 * the cause.
 */
export function requireNativeTypeScript(): void {
  const features = process.features as { typescript?: string | false };
  if (!features.typescript) {
    throw new Error(`Node ${process.versions.node} cannot run TypeScript natively — Tulipes apps need Node 24 (or 22.18+)`);
  }
}

/** @deprecated Since 0.11 nothing is registered; kept for callers written against 0.10. */
export async function registerTypeScript(): Promise<void> {
  requireNativeTypeScript();
}
