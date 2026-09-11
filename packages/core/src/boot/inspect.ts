import { readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { loadAcl } from "../acl/load-acl.js";
import { discoverModuleMeta } from "../env/meta-discovery.js";
import { BootReport } from "../errors/boot-error.js";
import { loadRoutes } from "./load-routes.js";
import { createRai, RouteRegistry } from "../http/rai.js";
import { scanRoutes } from "../http/route-scan.js";
import { discoverModules } from "../modules/discovery.js";
import { exploreModules } from "../modules/explorer.js";
import { sortModules } from "../modules/graph.js";
import type { Ctx } from "./contracts.js";

export type InspectionContext = Pick<Ctx, "config" | "routes" | "acl">;

/**
 * Load declarations and ACL only. No runtime environment, config factories,
 * models, handlers, translations, hooks or services are initialized.
 * Declaration imports are trusted JavaScript, not a sandbox.
 */
export async function inspectRoutes({ rootDir }: { rootDir: string }): Promise<InspectionContext> {
  const report = new BootReport();
  const modulesDir = join(rootDir, "modules");
  const order = sortModules(discoverModules(modulesDir, report), report);
  const metas = discoverModuleMeta(modulesDir, report);
  const owners = new Map<string, string>();
  for (const meta of metas) {
    for (const spec of meta.variables) {
      const owner = owners.get(spec.name);
      if (owner) report.add({ scope: "env", module: meta.module,
        message: `variable "${spec.name}" is already declared by module "${owner}" — one owner per variable` });
      owners.set(spec.name, meta.module);
    }
  }
  const explored = exploreModules(order);
  for (const files of explored) {
    if (!files.module.offline) report.add({ scope: "routes", module: files.module.name,
      message: "offline inspection requires tulipes.offline: true and defineRoutes factories in routes/*.routes; use --runtime for legacy factories" });
  }
  report.throwIfAny("offline declarations");

  const acl = await loadAcl(explored, report);
  const routes = new RouteRegistry();
  const rai = createRai(routes, (role, permission) => acl.can(role, permission));
  const app = express();
  await loadRoutes(app, explored, routes, rai, report);
  routes.record_(scanRoutes(app, report));
  report.throwIfAny("offline routes");

  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as { name?: string; version?: string };
  return { acl, routes, config: { app: { name: pkg.name ?? "api", ...(pkg.version && { version: pkg.version }) } } };
}
