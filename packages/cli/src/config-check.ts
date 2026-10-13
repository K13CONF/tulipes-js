import { TulipesBootError } from "@tulipes/core/errors";

import { appBoot, requireNativeTypeScript } from "./app-core.ts";

/**
 * `tulipes config:check` — boot in script mode, which loads every settings
 * namespace from the store the app declares (or core's file store) and
 * refuses invalid stored values the way a serving process would; then
 * print what each module runs with and exit. A deploy preflight for the
 * settings store, the way `env:check` is one for the environment.
 */
export async function runConfigCheck(rootDir: string): Promise<void> {
  requireNativeTypeScript();
  const boot = await appBoot(rootDir);
  let handle;
  try {
    handle = await boot({ rootDir, mode: "script", handleSignals: false });
  } catch (error) {
    if (error instanceof TulipesBootError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  try {
    const { settings } = handle.ctx;
    const namespaces = settings.namespaces();
    console.log(`APP_ENV=${handle.ctx.appEnv} — ${namespaces.length} settings namespace(s) in ${settings.status().label}:`);
    for (const namespace of namespaces) {
      const description = settings.describe(namespace);
      const { version, updated_at, updated_by } = description.stored;
      console.log(`  ✔ ${namespace}  v${version}  ${updated_at}  by ${updated_by.label ?? updated_by.id}`);
      for (const [field, value] of Object.entries(description.values)) {
        const pending = description.pendingRestart.includes(field) ? "  (restart pending)" : "";
        console.log(`      ${field} = ${JSON.stringify(value)}${pending}`);
      }
    }
  } finally {
    await handle.shutdown();
  }
}
