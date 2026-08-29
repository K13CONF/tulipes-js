import { BootReport } from "../errors/boot-error.js";
import { importFile } from "../boot/import-file.js";
import type { Ctx } from "../boot/contracts.js";
import type { ModuleFiles } from "../modules/explorer.js";
import { QueueManager, type QueueRegistry } from "./queue-manager.js";

/** Default export of `queues/*.queues.ts`. */
export type QueuesFn = (ctx: Ctx, queues: QueueRegistry) => void | Promise<void>;

/** Well-known infra variable, declared by the app's sys core module. */
const REDIS_URL = "REDIS_URL";

/**
 * Phase 9: run every `*.queues.ts` in load order. Same skip/refuse logic as
 * the database: a queue-less app is fine, queue files without REDIS_URL are
 * a contradiction.
 */
export async function initQueues(
  explored: readonly ModuleFiles[],
  ctx: Ctx,
  report: BootReport,
): Promise<QueueManager | undefined> {
  const hasQueueFiles = explored.some((files) => files.queueFiles.length > 0);
  const url = ctx.Environment.store.has(REDIS_URL)
    ? String(ctx.Environment.get(REDIS_URL))
    : undefined;

  if (!url) {
    if (hasQueueFiles) {
      report.add({
        scope: "boot",
        message: `modules declare queues but "${REDIS_URL}" is not declared/set — redis is required`,
      });
    }
    return undefined;
  }
  if (!hasQueueFiles) return undefined;

  const manager = new QueueManager(url);
  ctx.queues = manager;

  for (const { module, queueFiles } of explored) {
    for (const file of queueFiles) {
      const exported = await importFile<{ default?: unknown }>(
        file, "boot", module.name, report,
      );
      if (!exported) continue;

      if (typeof exported.default !== "function") {
        report.add({
          scope: "boot",
          module: module.name,
          message: `${file} must default-export a queues function (ctx, queues) => void`,
        });
        continue;
      }

      try {
        await (exported.default as QueuesFn)(
          ctx,
          manager.forModule(module.name, report),
        );
      } catch (error) {
        report.add({
          scope: "boot",
          module: module.name,
          message: `queues function threw: ${(error as Error).message}`,
        });
      }
    }
  }

  return manager;
}
