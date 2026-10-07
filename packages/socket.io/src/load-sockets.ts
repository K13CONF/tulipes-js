import { importFile, type Ctx } from "@tulipes/core/boot";
import type { BootReport } from "@tulipes/core/errors";
import type { ModuleFiles } from "@tulipes/core/modules";

import { SocketManager, type SocketRegistry } from "./socket-manager.ts";

/** Default export of `sockets/*.sockets.ts` (backend branch only). */
export type SocketsFn = (ctx: Ctx, sockets: SocketRegistry) => void | Promise<void>;

/**
 * Run by the provider in the backend process: create the Socket.IO server
 * and run every `*.sockets.ts` in load order so namespaces are claimed and
 * wired before core attaches the server and listens.
 */
export async function initSockets(
  explored: readonly ModuleFiles[],
  ctx: Ctx,
  report: BootReport,
  onManager?: (manager: SocketManager) => void,
): Promise<SocketManager> {
  const manager = new SocketManager();
  onManager?.(manager);
  ctx.sockets = manager;

  for (const { module, socketFiles } of explored) {
    for (const file of socketFiles) {
      const exported = await importFile<{ default?: unknown }>(
        file, "boot", module.name, report,
      );
      if (!exported) continue;

      if (typeof exported.default !== "function") {
        report.add({
          scope: "boot",
          module: module.name,
          message: `${file} must default-export a sockets function (ctx, sockets) => void`,
        });
        continue;
      }

      try {
        await (exported.default as SocketsFn)(
          ctx,
          manager.forModule(module.name, report),
        );
      } catch (error) {
        report.add({
          scope: "boot",
          module: module.name,
          message: `sockets function threw: ${(error as Error).message}`,
        });
      }
    }
  }

  return manager;
}
