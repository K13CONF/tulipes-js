import type { Ctx } from "@tulipes/core/boot";

import { closeCache } from "./helpers/cache/index.js";
import { registerBasePlugins } from "./helpers/mongoose/index.js";

/**
 * Registering here — phase 6, before models compile in phase 8 — is what
 * makes the base plugins apply in EVERY mode: backend, worker and script
 * alike. Doing it in app.ts instead would leave scripts compiling models
 * without timestamps or the soft-delete guard, so a script would happily
 * return rows the API considers deleted.
 */
registerBasePlugins();

export default function coreConfig(_ctx: Ctx) {
  return {};
}

/** The sys core module owns app-wide infra glue lifecycles. */
export async function onShutdown(): Promise<void> {
  await closeCache();
}
