import type { Provider } from "../boot/providers.js";
import { initDatabase } from "./database.js";

/**
 * Core's built-in Mongoose implementation, exposed as the "models" provider
 * the app declares with `"tulipes": { "providers": { "models": "@tulipes/core/db" } }`.
 * It is the same loader boot always ran; the provider seam is what lets it
 * move into its own package (S09.4) without the app changing anything but
 * that specifier.
 */
const provider: Provider<"models"> = {
  contract: 1,
  capability: "models",
  name: "mongoose",
  async acquire({ ctx, files, runBootstrap }, report, own) {
    const connection = await initDatabase(files, ctx, report, {
      runBootstrap,
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

export default provider;
