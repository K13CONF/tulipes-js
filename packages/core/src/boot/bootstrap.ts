import { BootReport } from "../errors/boot-error.ts";
import type { ModuleFiles } from "../modules/explorer.ts";
import { importFile } from "./import-file.ts";
import type { BootstrapCleanup, BootstrapFn, RuntimeCtx } from "./contracts.ts";

export interface RegisteredCleanup {
  module: string;
  file: string;
  cleanup: BootstrapCleanup;
}

/**
 * Boot phase 9: every `bootstrap/*.bootstrap.ts`, in load order, in every
 * mode. It is the one place a module initializes — seeds, indexes, a
 * client it keeps open — and the function may return the cleanup for what
 * it opened. Core runs those after traffic drains, in reverse order, under
 * the shutdown deadline. A seed that should not run from a one-off script
 * checks `ctx.mode` itself.
 */
export async function runBootstrap(
  explored: readonly ModuleFiles[],
  ctx: RuntimeCtx,
  report: BootReport,
): Promise<RegisteredCleanup[]> {
  const cleanups: RegisteredCleanup[] = [];

  for (const { module, bootstrapFiles } of explored) {
    for (const file of bootstrapFiles) {
      const exported = await importFile<{ default?: unknown }>(file, "boot", module.name, report);
      if (!exported) continue;

      if (typeof exported.default !== "function") {
        report.add({ scope: "boot", module: module.name, message: `${file} must default-export a bootstrap function (ctx) => cleanup | void` });
        continue;
      }

      try {
        const result = await (exported.default as BootstrapFn)(ctx);
        if (typeof result === "function") cleanups.push({ module: module.name, file, cleanup: result });
        else if (result !== undefined) {
          report.add({ scope: "boot", module: module.name, message: `${file} returned ${typeof result}; a bootstrap returns nothing or its cleanup function` });
        }
      } catch (error) {
        report.add({ scope: "boot", module: module.name, message: `bootstrap task ${file} threw: ${(error as Error).message}` });
      }
    }
  }

  return cleanups;
}
