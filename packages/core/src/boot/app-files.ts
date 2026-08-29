import { existsSync } from "node:fs";
import { join } from "node:path";

import { BootReport } from "../errors/boot-error.js";
import { detectSourceExtension } from "../modules/explorer.js";
import { importFile } from "./import-file.js";
import type { Ctx } from "./contracts.js";

/**
 * The two app-level (non-module) convention files. Both are optional —
 * an app that needs neither simply doesn't create them.
 *
 *   config/app.config.ts   default-exports (Environment) => object; the
 *                          result seeds the global config BEFORE any module
 *                          factory runs. The place for app-wide values that
 *                          belong to no single module.
 *
 *   app.middleware.ts      named exports beforeRoutes / afterRoutes; the
 *                          app's slots in the web request pipeline (see
 *                          startWeb for the exact order).
 */

export type AppConfigFn = (
  environment: Ctx["Environment"],
) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;

export interface AppMiddleware {
  /** After core middleware (headers, logging, parsers), before module routers. */
  beforeRoutes?: (ctx: Ctx) => void | Promise<void>;
  /** After module routers, before the 404 + error handlers. */
  afterRoutes?: (ctx: Ctx) => void | Promise<void>;
}

export async function loadAppConfigSeed(
  rootDir: string,
  ctx: Ctx,
  report: BootReport,
): Promise<void> {
  const file = join(rootDir, "config", `app.config${detectSourceExtension()}`);
  if (!existsSync(file)) return;

  const exported = await importFile<{ default?: unknown }>(file, "config", "app", report);
  if (!exported) return;

  if (typeof exported.default !== "function") {
    report.add({
      scope: "config",
      message: "config/app.config must default-export a function (Environment) => object",
    });
    return;
  }

  try {
    const seed = await (exported.default as AppConfigFn)(ctx.Environment);
    Object.assign(ctx.config, seed ?? {});
  } catch (error) {
    report.add({
      scope: "config",
      message: `app.config threw: ${(error as Error).message}`,
    });
  }
}

export async function loadAppMiddleware(
  rootDir: string,
  report: BootReport,
): Promise<AppMiddleware> {
  const file = join(rootDir, `app.middleware${detectSourceExtension()}`);
  if (!existsSync(file)) return {};

  const exported = await importFile<AppMiddleware>(file, "boot", "app", report);
  if (!exported) return {};

  const hooks: AppMiddleware = {};
  for (const hook of ["beforeRoutes", "afterRoutes"] as const) {
    const value = exported[hook];
    if (value === undefined) continue;
    if (typeof value !== "function") {
      report.add({
        scope: "boot",
        message: `app.middleware export "${hook}" must be a function`,
      });
      continue;
    }
    hooks[hook] = value;
  }
  return hooks;
}
