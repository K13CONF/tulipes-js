import { createConnection, Schema, type Connection } from "mongoose";

import { BootReport } from "../errors/boot-error.js";
import { importFile } from "../boot/import-file.js";
import type { Ctx, DatabaseCtx } from "../boot/contracts.js";
import type { ModuleFiles } from "../modules/explorer.js";
import { ModelStore } from "./model-store.js";

/**
 * Model files are pure definitions — no factory, no ctx. The loader turns
 * them into live models on the shared connection.
 */
export interface ModelDef {
  name: string;
  schema: Schema;
  /** Override mongoose's automatic collection naming when needed. */
  collection?: string;
}

/** Default export of `bootstrap/*.bootstrap.ts` — post-DB, pre-server init. */
export type BootstrapFn = (ctx: DatabaseCtx) => void | Promise<void>;

/** Well-known infra variable, declared by the app's sys core module. */
const MONGO_URI = "MONGO_URI";

/**
 * Boot phase 8: connect, register every model in load order, then run every
 * bootstrap task in load order (indexes, seed roles, default records).
 *
 * A DB-less app is legitimate — no models and no MONGO_URI simply skips the
 * phase. Declaring models *without* a connection string, though, is a
 * contradiction the boot must refuse.
 */
export interface InitDatabaseOptions {
  /**
   * Bootstrap tasks seed and ensure indexes for a process about to serve.
   * A one-shot script skips them: they are somebody else's startup work,
   * and running them on every `ls`-style script is wasted writes.
   */
  runBootstrap?: boolean;
  /** Register ownership before connecting or compiling models can fail. */
  onConnection?: (connection: Connection) => void;
}

export async function initDatabase(
  explored: readonly ModuleFiles[],
  ctx: Ctx,
  report: BootReport,
  options: InitDatabaseOptions = {},
): Promise<Connection | undefined> {
  const hasModels = explored.some((files) => files.modelFiles.length > 0);
  const uri = ctx.Environment.store.has(MONGO_URI)
    ? String(ctx.Environment.get(MONGO_URI))
    : undefined;

  if (!uri) {
    if (hasModels) {
      report.add({
        scope: "boot",
        message: `modules declare models but "${MONGO_URI}" is not declared/set — a database is required`,
      });
    }
    return undefined;
  }

  let connection: Connection;
  try {
    // Fail fast: default server selection waits 30s before reporting an
    // unreachable database — far too long for a boot-time verdict.
    connection = createConnection(uri, {
      serverSelectionTimeoutMS: 5_000,
    });
    options.onConnection?.(connection);
    await connection.asPromise();
  } catch (error) {
    report.add({
      scope: "boot",
      message: `database connection failed (${MONGO_URI}): ${(error as Error).message}`,
    });
    return undefined;
  }

  const store = new ModelStore();
  ctx.models = store;

  await registerModels(explored, connection, store, report);

  // Bootstrap tasks only make sense against a fully-populated model store,
  // and only when nothing above them failed.
  if ((options.runBootstrap ?? true) && report.issues.length === 0) {
    await runBootstrapTasks(explored, ctx, report);
  }

  return connection;
}

async function registerModels(
  explored: readonly ModuleFiles[],
  connection: Connection,
  store: ModelStore,
  report: BootReport,
): Promise<void> {
  for (const { module, modelFiles } of explored) {
    for (const file of modelFiles) {
      const exported = await importFile<{ default?: unknown }>(
        file, "boot", module.name, report,
      );
      if (!exported) continue;

      const def = exported.default as Partial<ModelDef> | undefined;
      if (
        typeof def?.name !== "string" ||
        !(def.schema instanceof Schema)
      ) {
        report.add({
          scope: "boot",
          module: module.name,
          message: `${file} must default-export { name, schema } (a ModelDef)`,
        });
        continue;
      }

      const owner = store.ownerOf(def.name);
      if (owner) {
        report.add({
          scope: "boot",
          module: module.name,
          message: `model "${def.name}" is already registered by module "${owner}"`,
        });
        continue;
      }

      const model = connection.model(def.name, def.schema, def.collection);
      store.register_(def.name as string, model as never, module.name);
    }
  }
}

async function runBootstrapTasks(
  explored: readonly ModuleFiles[],
  ctx: Ctx,
  report: BootReport,
): Promise<void> {
  for (const { module, bootstrapFiles } of explored) {
    for (const file of bootstrapFiles) {
      const exported = await importFile<{ default?: unknown }>(
        file, "boot", module.name, report,
      );
      if (!exported) continue;

      if (typeof exported.default !== "function") {
        report.add({
          scope: "boot",
          module: module.name,
          message: `${file} must default-export a bootstrap function (ctx) => void`,
        });
        continue;
      }

      try {
        await (exported.default as BootstrapFn)(ctx as DatabaseCtx);
      } catch (error) {
        report.add({
          scope: "boot",
          module: module.name,
          message: `bootstrap task ${file} threw: ${(error as Error).message}`,
        });
      }
    }
  }
}
