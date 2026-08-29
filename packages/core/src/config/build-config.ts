import { BootReport } from "../errors/boot-error.js";
import type { ModuleFiles } from "../modules/explorer.js";
import { importFile } from "../boot/import-file.js";
import type {
  Ctx,
  LifecycleHook,
  ModuleConfigFn,
  ModuleLifecycle,
} from "../boot/contracts.js";

interface ConfigModuleShape {
  default?: unknown;
  onReady?: unknown;
  onShutdown?: unknown;
}

/**
 * Boot phase 6: run every `module.config.ts` factory in load order, merging
 * each result into the global config under the module's short name, and
 * collect the lifecycle hooks exported alongside them.
 *
 * The ctx handed to each factory carries the config built *so far* — load
 * order is dependency order, so a module can safely read the namespaces of
 * anything it declared in `dependsOn`.
 */
export async function buildGlobalConfig(
  explored: readonly ModuleFiles[],
  ctx: Ctx,
  report: BootReport,
): Promise<ModuleLifecycle[]> {
  const lifecycles: ModuleLifecycle[] = [];

  for (const { module, configFile } of explored) {
    if (!configFile) continue;

    const exported = await importFile<ConfigModuleShape>(
      configFile,
      "config",
      module.name,
      report,
    );
    if (!exported) continue;

    const lifecycle = collectLifecycle(module.name, exported, report);
    if (lifecycle) lifecycles.push(lifecycle);

    if (typeof exported.default !== "function") {
      report.add({
        scope: "config",
        module: module.name,
        message: "module.config must default-export a function (ctx) => config",
      });
      continue;
    }

    try {
      const result = await (exported.default as ModuleConfigFn)(ctx);
      ctx.config[module.name] = result ?? {};
    } catch (error) {
      report.add({
        scope: "config",
        module: module.name,
        message: `config factory threw: ${(error as Error).message}`,
      });
    }
  }

  return lifecycles;
}

function collectLifecycle(
  moduleName: string,
  exported: ConfigModuleShape,
  report: BootReport,
): ModuleLifecycle | undefined {
  const lifecycle: ModuleLifecycle = { module: moduleName };

  for (const hook of ["onReady", "onShutdown"] as const) {
    const value = exported[hook];
    if (value === undefined) continue;
    if (typeof value !== "function") {
      report.add({
        scope: "config",
        module: moduleName,
        message: `exported "${hook}" must be a function`,
      });
      continue;
    }
    lifecycle[hook] = value as LifecycleHook;
  }

  return lifecycle.onReady || lifecycle.onShutdown ? lifecycle : undefined;
}
