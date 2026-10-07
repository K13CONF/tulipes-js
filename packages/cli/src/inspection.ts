import type { BootHandle } from "@tulipes/core/boot";

import { appBoot, requireNativeTypeScript } from "./app-core.ts";

/**
 * `tulipes routes` and `tulipes spec` boot the app in inspection: every
 * route mounted, nothing acquired — the environment declared but
 * unresolved, providers as stubs, settings as their defaults, no bootstrap,
 * no listener. No `.env`, no secret and no service is needed, and a routes
 * file that touches infrastructure while building fails here with its path.
 */
export async function inspectApp(rootDir: string): Promise<BootHandle> {
  requireNativeTypeScript();
  const boot = await appBoot(rootDir);
  return boot({ rootDir, mode: "backend", handleSignals: false, inspect: true });
}
