import type { Express } from "express";
import { BootReport } from "../errors/boot-error.js";
import { isDefinedRoutes, runtimeBindings } from "../http/define-routes.js";
import { scanRoutes } from "../http/route-scan.js";
import type { RouteRegistry } from "../http/rai.js";
import type { ModuleFiles } from "../modules/explorer.js";
import { importFile } from "./import-file.js";
import type { BackendCtx, RoutesFn } from "./contracts.js";

/** Both tooling and boot compose the same native routers in module/file order. */
export async function loadRoutes(
  app: Express,
  explored: readonly ModuleFiles[],
  registry: RouteRegistry,
  rai: BackendCtx["rai"],
  report: BootReport,
  runtimeCtx?: BackendCtx,
): Promise<void> {
  for (const { module, routeFiles } of explored) {
    for (const file of routeFiles) {
      const exported = await importFile<{ default?: unknown }>(file, "routes", module.name, report);
      if (!exported) continue;
      const build = exported.default;
      const defined = isDefinedRoutes(build);
      if (typeof build !== "function" || ((!runtimeCtx || module.offline) && !defined)) {
        report.add({ scope: "routes", module: module.name,
          message: `${file} must default-export ${module.offline || !runtimeCtx ? "defineRoutes(...) for offline inspection" : "a routes function"}` });
        continue;
      }
      registry.currentModule = module.name;
      try {
        if (defined) {
          const bindings = runtimeBindings();
          const router = await build({ app, rai, routes: registry, runtime: bindings.runtime });
          if (router !== undefined && typeof router !== "function") throw new Error("defineRoutes must return a Router or void");
          if (router) registry.mount(app, "", router);
          if (runtimeCtx) {
            const before = scanRoutes(app, report);
            const checker = registry.checker;
            await bindings.initialize(runtimeCtx);
            const after = scanRoutes(app, report);
            if (checker !== registry.checker || before.length !== after.length || before.some((record, index) => {
              const next = after[index];
              return !next || record.method !== next.method || record.path !== next.path || record.info !== next.info || record.module !== next.module;
            })) throw new Error("runtime() changed routes or access policy; declare them in defineRoutes instead");
          }
        } else {
          const router = await (build as RoutesFn)(runtimeCtx!);
          if (typeof router === "function") registry.mount(app, "", router);
        }
      } catch (error) {
        report.add({ scope: "routes", module: module.name, message: `routes function threw: ${(error as Error).message}` });
      } finally {
        registry.currentModule = "(app)";
      }
    }
  }
}
