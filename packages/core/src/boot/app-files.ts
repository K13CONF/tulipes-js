import { existsSync } from "node:fs";
import { join } from "node:path";

import type { EnvValues } from "../config/index.ts";
import { BootReport } from "../errors/boot-error.ts";
import type { ModuleManifest } from "../modules/manifest.ts";
import type { AppEnv } from "./app-env.ts";
import type { ProcessMode } from "./boot.ts";
import type { Ctx } from "./contracts.ts";
import { importFile } from "./import-file.ts";

/**
 * The one app-level (non-module) convention file. Optional — an app that
 * doesn't need it simply doesn't create it.
 *
 *   config/app.config.ts   default-exports (env, { appEnv, mode }) => object;
 *                          the result seeds the global config BEFORE any
 *                          module factory runs. The place for app-wide values
 *                          that belong to no single module, and where the
 *                          environment is wired to what core and the
 *                          providers read: `server.port`, `mongoose.uri`,
 *                          `bullmq.redisUrl`.
 *
 * There is deliberately no app-level middleware file: global middleware is
 * a sys module's job — sys modules load before everything, so their routes
 * files mounting on ctx.app IS the "before all routes" slot.
 */

/** What the app config may decide on besides the values: which deployment and which process this is. */
export interface AppConfigMeta {
  appEnv: AppEnv;
  mode: ProcessMode;
}

/**
 * `env` is every module's resolved environment values, frozen:
 * `env.core.port`, `env.auth.jwtAccessSecret`. Under inspection a value
 * that is missing or invalid is `undefined` rather than an error, so the
 * seed must only wire values, never require them.
 */
export type AppConfigFn = (
  env: EnvValues,
  meta: AppConfigMeta,
) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;

export async function loadAppConfigSeed(
  rootDir: string,
  ctx: Ctx,
  env: EnvValues,
  report: BootReport,
): Promise<void> {
  // Whichever extension exists wins (.ts first) — the app decides its own
  // world; core's compilation state must never influence discovery.
  const file = [".ts", ".js"]
    .map((ext) => join(rootDir, "config", `app.config${ext}`))
    .find((candidate) => existsSync(candidate));
  if (!file) return;

  const exported = await importFile<{ default?: unknown }>(file, "config", "app", report);
  if (!exported) return;

  if (typeof exported.default !== "function") {
    report.add({
      scope: "config",
      message: "config/app.config must default-export a function (env, { appEnv, mode }) => object",
    });
    return;
  }

  let seed: Record<string, unknown> | void;
  try {
    seed = await (exported.default as AppConfigFn)(env, { appEnv: ctx.appEnv, mode: ctx.mode });
  } catch (error) {
    report.add({ scope: "config", message: `app.config threw: ${(error as Error).message}` });
    return;
  }

  // A module's namespace is its own: its settings and its environment
  // values land there, and a seed under that name would be overwritten by
  // phase 6 without a word.
  for (const key of claimedByModules(seed ?? {}, ctx.modules)) {
    report.add({ scope: "config", message: `app.config returns "${key}", which is the config namespace of module "${key}" — app-level keys may not be named after a module` });
  }

  Object.assign(ctx.config, seed ?? {});
}

function claimedByModules(seed: Record<string, unknown>, modules: readonly ModuleManifest[]): string[] {
  const names = new Set(modules.map((module) => module.name));
  return Object.keys(seed).filter((key) => names.has(key));
}
