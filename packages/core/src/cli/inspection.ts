import { appBoot, importFromApp, registerTypeScript } from "./app-core.js";
import { inspectRoutes, type InspectionContext } from "../boot/inspect.js";
import type { Environment } from "../env/environment.js";

/** Shared CLI lifetime; offline inspection acquires no application resources. */
export async function inspectApp(rootDir: string, offline = false): Promise<{
  ctx: InspectionContext;
  env?: Environment;
  shutdown(): Promise<void>;
}> {
  await registerTypeScript();
  if (offline) {
    const core = await importFromApp<{ inspectRoutes?: typeof inspectRoutes }>(rootDir, "@tulipes/core/boot");
    if (core && !core.inspectRoutes) throw new Error("The app's @tulipes/core does not support --offline; upgrade it or use --runtime");
    return { ctx: await (core?.inspectRoutes ?? inspectRoutes)({ rootDir }), shutdown: async () => {} };
  }
  const boot = await appBoot(rootDir);
  return boot({ rootDir, mode: "backend", handleSignals: false, inspect: true });
}
