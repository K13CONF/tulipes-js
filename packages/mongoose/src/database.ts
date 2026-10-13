import { createConnection, Schema, type Connection } from "mongoose";

import { importFile, type Ctx } from "@tulipes/core/boot";
import type { BootReport } from "@tulipes/core/errors";

import { CONNECTION_CONFIG, readConnectionConfig } from "./connection-config.ts";
import type { ModuleFiles } from "@tulipes/core/modules";

import { ModelStore } from "./model-store.ts";

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

/**
 * Kept for apps written against 0.10, where bootstrap was this provider's.
 * Since 0.11 core runs bootstrap files in every mode and the function may
 * return its cleanup; prefer `BootstrapFn` from `@tulipes/core/boot`.
 */
export type { BootstrapFn } from "@tulipes/core/boot";

/**
 * Boot phase 5, run by the provider below: connect and register every model
 * in load order. Bootstrap tasks (indexes, seed rows) are core's phase 9,
 * run against the loaded settings and ACL.
 *
 * Reached only when the app declared this provider, so a missing connection
 * string is a contradiction the boot must refuse — an app without a database
 * simply declares no provider.
 */
export interface InitDatabaseOptions {
  /** Register ownership before connecting or compiling models can fail. */
  onConnection?: (connection: Connection) => void;
}

export async function initDatabase(
  explored: readonly ModuleFiles[],
  ctx: Ctx,
  report: BootReport,
  options: InitDatabaseOptions = {},
): Promise<Connection | undefined> {
  const target = readConnectionConfig(ctx, "mongoose", report);
  if (!target) return undefined;

  let connection: Connection;
  try {
    // Fail fast: default server selection waits 30s before reporting an
    // unreachable database — far too long for a boot-time verdict.
    connection = createConnection(target.uri, {
      ...target.options,
      serverSelectionTimeoutMS: 5_000,
    });
    options.onConnection?.(connection);
    await connection.asPromise();
  } catch (error) {
    report.add({
      scope: "boot",
      message: `database connection failed (${CONNECTION_CONFIG}): ${(error as Error).message}`,
    });
    return undefined;
  }

  const store = new ModelStore(connection);
  ctx.models = store;

  await registerModels(explored, connection, store, report);

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
