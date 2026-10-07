import { importFile, type Ctx } from "@tulipes/core/boot";
import type { BootReport } from "@tulipes/core/errors";
import type { ModuleFiles } from "@tulipes/core/modules";

import { QueueManager, type JobSchema, type QueueRegistry } from "./queue-manager.js";

/** Default export of `queues/*.queues.ts`. */
export type QueuesFn = (ctx: Ctx, queues: QueueRegistry) => void | Promise<void>;

/** Well-known infra variable, declared by the app's sys core module. */
const REDIS_URL = "REDIS_URL";

/**
 * Phase 8, run by the provider: run every `*.queues.ts` in load order so
 * producers exist in every process and processors are registered for the
 * worker to start. Reached only when the app declared the provider, so a
 * missing connection string is a contradiction the boot must refuse.
 */
export async function initQueues(
  explored: readonly ModuleFiles[],
  ctx: Ctx,
  report: BootReport,
  onManager?: (manager: QueueManager) => void,
): Promise<QueueManager | undefined> {
  const url = ctx.Environment.store.has(REDIS_URL)
    ? String(ctx.Environment.get(REDIS_URL))
    : undefined;

  if (!url) {
    report.add({
      scope: "providers",
      message: `provider "bullmq" is selected but "${REDIS_URL}" is not declared/set — declare it in a sys module's package.json tulipes.env and set it`,
    });
    return undefined;
  }

  const manager = new QueueManager(url);
  // Owned before any queue file runs: a define() opens a connection.
  onManager?.(manager);
  ctx.queues = manager;

  for (const { module, queueFiles } of explored) {
    for (const file of queueFiles) {
      const exported = await importFile<{ default?: unknown; jobs?: unknown }>(
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

      const registry = manager.forModule(module.name, report);
      try {
        await (exported.default as QueuesFn)(ctx, registry);
      } catch (error) {
        report.add({
          scope: "boot",
          module: module.name,
          message: `queues function threw: ${(error as Error).message}`,
        });
        continue;
      }

      if (exported.jobs !== undefined) registerJobs(file, exported.jobs, registry, report, module.name);
    }
  }

  return manager;
}

/**
 * The `jobs` export — `{ [queueName]: schema }` — is the declaration
 * `tulipes sync` types `KnownJobs` from, so it carries runtime weight too:
 * each schema validates `add()` payloads, and a queue named only there is
 * defined with default options, so the common file does not repeat itself.
 */
function registerJobs(
  file: string,
  jobs: unknown,
  registry: QueueRegistry,
  report: BootReport,
  moduleName: string,
): void {
  const refuse = (message: string) => report.add({ scope: "boot", module: moduleName, message: `${file}: ${message}` });
  if (typeof jobs !== "object" || jobs === null || Array.isArray(jobs)) {
    refuse("`jobs` must be an object of queue name → schema");
    return;
  }
  for (const [name, schema] of Object.entries(jobs)) {
    if (typeof (schema as JobSchema | null)?.safeParse !== "function") {
      refuse(`jobs["${name}"] is not a schema (expected a zod schema with safeParse)`);
      continue;
    }
    registry.declare_(name, schema as JobSchema);
  }
}
