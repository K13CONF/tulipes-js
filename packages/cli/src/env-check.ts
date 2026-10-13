import { join } from "node:path";

import { resolveAppEnv, resolveEnv } from "@tulipes/core/boot";
import { BootReport, TulipesBootError } from "@tulipes/core/errors";
import { discoverModules } from "@tulipes/core/modules";

/**
 * `tulipes env:check` — boot phase 1 and nothing else: resolve every
 * declared variable from the process, the env file and the defaults, print
 * where each landed in the config and from which source, exit non-zero on
 * any problem. Built for CI gates and deploy preflights; also the one place
 * to *see* the values, since `ctx.config` keeps them out of every listing.
 */
export async function runEnvCheck(rootDir: string): Promise<void> {
  const report = new BootReport();
  try {
    const appEnv = resolveAppEnv(undefined, report);
    report.throwIfAny("environment");
    const manifests = discoverModules(join(rootDir, "modules"), report);
    report.throwIfAny("module graph");
    const resolved = resolveEnv(manifests, { appEnv, envsDir: join(rootDir, ".envs") }, report);
    report.throwIfAny("environment");

    const lines = resolved.snapshot();
    console.log(`APP_ENV=${appEnv} — ${lines.length} variable(s) resolved:`);
    for (const { module, name, key, value } of lines) {
      const shown = value === undefined ? "(not set)" : String(value);
      console.log(`  ✔ config.${module}.${name} ← ${key}=${shown}`);
    }
  } catch (error) {
    if (!(error instanceof TulipesBootError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}
