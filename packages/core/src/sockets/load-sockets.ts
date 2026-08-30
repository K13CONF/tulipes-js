import type { Server as HttpServer } from "node:http";

import { BootReport } from "../errors/boot-error.js";
import { importFile } from "../boot/import-file.js";
import type { Ctx } from "../boot/contracts.js";
import type { ModuleFiles } from "../modules/explorer.js";
import { SocketManager, type SocketRegistry } from "./socket-manager.js";

/** Default export of `sockets/*.sockets.ts` (backend branch only). */
export type SocketsFn = (ctx: Ctx, sockets: SocketRegistry) => void | Promise<void>;

/**
 * Phase 11b: attach Socket.IO to the http server and run every
 * `*.sockets.ts` in load order. No socket files → no Socket.IO server at
 * all; websockets are opt-in per app, not a standing cost.
 */
export async function initSockets(
  explored: readonly ModuleFiles[],
  ctx: Ctx,
  httpServer: HttpServer,
  report: BootReport,
): Promise<SocketManager | undefined> {
  if (!explored.some((files) => files.socketFiles.length > 0)) {
    return undefined;
  }

  const manager = new SocketManager(httpServer);
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
