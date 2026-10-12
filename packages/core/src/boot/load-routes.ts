import type { Express } from "express";
import { BootReport } from "../errors/boot-error.ts";
import type { RouteRegistry } from "../http/rai.ts";
import type { ModuleFiles } from "../modules/explorer.ts";
import { importFile } from "./import-file.ts";
import type { BackendCtx, RoutesFn } from "./contracts.ts";

/**
 * Backend branch and inspection alike: every `*.routes.ts` under `routes/` (scope folders included) is a
 * plain `(ctx) => Router | void` run in module and file order. A returned
 * router is mounted under the configured prefix; a file that mounts on
 * `ctx.app` itself (global middleware) returns nothing. Under inspection
 * `ctx` carries stubs for the environment and the providers, so a file that
 * touches infrastructure while building its router fails here, with its
 * path, instead of being tolerated.
 */
export async function loadRoutes(
  app: Express,
  explored: readonly ModuleFiles[],
  registry: RouteRegistry,
  ctx: BackendCtx,
  report: BootReport,
): Promise<void> {
  void app;
  for (const { module, routeFiles } of explored) {
    for (const file of routeFiles) {
      const exported = await importFile<{ default?: unknown }>(file, "routes", module.name, report);
      if (!exported) continue;
      const build = exported.default;
      if (typeof build !== "function") {
        report.add({ scope: "routes", module: module.name, message: `${file} must default-export a routes function (ctx) => Router | void` });
        continue;
      }
      registry.currentModule = module.name;
      try {
        const router = await (build as RoutesFn)(ctx);
        if (router !== undefined && typeof router !== "function") throw new Error("a routes function returns a Router or nothing");
        if (router) registry.mount(router);
      } catch (error) {
        report.add({ scope: "routes", module: module.name, message: `routes function threw: ${(error as Error).message}` });
      } finally {
        registry.currentModule = "(app)";
      }
    }
  }
}
