import { existsSync } from "node:fs";
import { join } from "node:path";

import { BootReport } from "../errors/boot-error.ts";
import { importFile } from "./import-file.ts";
import type { Ctx } from "./contracts.ts";

/**
 * The one app-level (non-module) convention file. Optional — an app that
 * doesn't need it simply doesn't create it.
 *
 *   config/app.config.ts   default-exports (Environment) => object; the
 *                          result seeds the global config BEFORE any module
 *                          factory runs. The place for app-wide values that
 *                          belong to no single module.
 *
 * There is deliberately no app-level middleware file: global middleware is
 * a sys module's job — sys modules load before everything, so their routes
 * files mounting on ctx.app IS the "before all routes" slot.
 */

export type AppConfigFn = (
  environment: Ctx["Environment"],
) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;

export async function loadAppConfigSeed(
  rootDir: string,
  ctx: Ctx,
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

