import type { Provider } from "@tulipes/core/boot";

import { initDatabase } from "./database.js";

/**
 * The "models" provider an app selects with
 * `"tulipes": { "providers": { "models": "@tulipes/mongoose" } }`.
 *
 * Core owns the phase order, the shutdown deadline and the aggregate boot
 * report; this package owns the connection, model compilation, bootstrap
 * policy and the driver's own close/force-close. `mongoose` is a peer
 * dependency on purpose: the app's schemas and this provider must share one
 * instance, or `instanceof Schema` and the app's global plugins stop applying.
 */
export const provider: Provider<"models"> = {
  contract: 2,
  capability: "models",
  name: "mongoose",
  async acquire({ ctx, files }, report, own) {
    const connection = await initDatabase(files, ctx, report, {
      // Registered before the connection is awaited: a database that never
      // answers is still closed by core's failed-boot cleanup.
      onConnection: (connection) => own({
        dispose: () => connection.close(),
        forceDispose: () => connection.destroy(true),
        status: () => ({
          label: `mongodb://${connection.host}:${connection.port}/${connection.name}`,
          ready: connection.readyState === 1,
        }),
      }),
    });
    return connection ? ctx.models : undefined;
  },
};
