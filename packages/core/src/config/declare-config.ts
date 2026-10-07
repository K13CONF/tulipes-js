import { BootReport } from "../errors/boot-error.ts";
import type { ModuleFiles } from "../modules/explorer.ts";
import { importFile } from "../boot/import-file.ts";
import { isConfigDeclaration } from "./define-config.ts";
import type { Settings } from "./settings.ts";

/**
 * Boot phase 4: import every `module.config.ts` and register its
 * declaration. No value exists yet — the store is read in phase 6, after
 * the models provider has a connection — so this phase runs before any
 * infrastructure and the file may import zod, types and nothing that
 * touches a service.
 *
 * The 0.10 forms are refused by name: a factory default export, and the
 * lifecycle exports, whose jobs moved to bootstrap files and `ctx.signal`.
 */
export async function declareConfig(
  explored: readonly ModuleFiles[],
  settings: Settings,
  report: BootReport,
): Promise<void> {
  for (const { module, configFile } of explored) {
    if (!configFile) continue;

    const exported = await importFile<Record<string, unknown>>(configFile, "config", module.name, report);
    if (!exported) continue;

    for (const name of Object.keys(exported)) {
      if (name === "default") continue;
      const hint = name === "onReady" || name === "onShutdown" || name === "onDrain"
        ? ` — initialization is a bootstrap/*.bootstrap.ts file, which may return its cleanup; long-lived work ends on ctx.signal`
        : "";
      report.add({ scope: "config", module: module.name, message: `module.config exports "${name}": its only export is the default defineConfig({ schema })${hint}` });
    }

    const declaration = exported.default;
    if (!isConfigDeclaration(declaration)) {
      report.add({
        scope: "config",
        module: module.name,
        message: typeof declaration === "function"
          ? "module.config default-exports a factory — the 0.10 form; export defineConfig({ schema }) and move the values into the settings store (tulipes config:import carries them over)"
          : "module.config must default-export defineConfig({ schema })",
      });
      continue;
    }

    settings.declare_(module.name, declaration, report);
  }
}
