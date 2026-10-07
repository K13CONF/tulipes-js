import { createConnection, type Connection } from "mongoose";

import type { Provider } from "@tulipes/core/boot";

import { MongoSettingsStore } from "./settings-store.ts";

/** Well-known infra variable, declared by the app's sys core module. */
const MONGO_URI = "MONGO_URI";

/**
 * The "settings" provider an app selects with
 * `"tulipes": { "providers": { "settings": "@tulipes/mongoose/settings" } }`.
 *
 * Acquired right after the models provider, so an app that selected this
 * package for its models shares that connection; one that keeps settings
 * in MongoDB without mongoose models opens its own. Either way the store is
 * what core wraps in the settings manager — it never lands on ctx itself.
 */
export const provider: Provider<"settings"> = {
  contract: 2,
  capability: "settings",
  name: "mongoose-settings",
  async acquire({ ctx }, report, own) {
    const shared = (ctx.models as { connection?: Connection } | undefined)?.connection;
    let connection = shared;
    let store: MongoSettingsStore | undefined;

    if (!connection) {
      const uri = ctx.Environment.store.has(MONGO_URI) ? String(ctx.Environment.get(MONGO_URI)) : undefined;
      if (!uri) {
        report.add({
          scope: "providers",
          message: `provider "mongoose-settings" is selected but "${MONGO_URI}" is not declared/set — declare it in a sys module's package.json tulipes.env and set it`,
        });
        return undefined;
      }
      try {
        connection = createConnection(uri, { serverSelectionTimeoutMS: 5_000 });
        const owned = connection;
        own({
          dispose: async () => { await store?.dispose(); await owned.close(); },
          forceDispose: () => owned.destroy(true),
          status: () => store?.status() ?? { label: `mongodb://${owned.host}:${owned.port}/${owned.name}.settings`, ready: owned.readyState === 1 },
        });
        await connection.asPromise();
      } catch (error) {
        report.add({ scope: "providers", message: `settings database connection failed (${MONGO_URI}): ${(error as Error).message}` });
        return undefined;
      }
    } else {
      // The connection belongs to the models provider; this resource only
      // owns the watch, which must stop before that connection closes.
      own({
        dispose: () => store?.dispose(),
        status: () => store?.status() ?? { label: "mongodb settings", ready: false },
      });
    }

    store = new MongoSettingsStore(connection);
    return store;
  },
};

export default provider;
