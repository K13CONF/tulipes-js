import type { ConnectOptions } from "mongoose";

import type { Ctx } from "@tulipes/core/boot";
import type { BootReport } from "@tulipes/core/errors";

/**
 * Where this package reads how to reach MongoDB: `config.mongoose`, set by
 * the app's `config/app.config.ts` from the variables its sys module
 * declares. Either a full URI — the only way to name a replica set, an
 * Atlas `mongodb+srv://` cluster or driver options — or a host URI with the
 * credentials and database name beside it, which the driver assembles
 * itself so nothing is URL-encoded by hand:
 *
 *   mongoose: env.core.mongodbUri
 *     ? { uri: env.core.mongodbUri }
 *     : { uri: env.core.mongodbHost, user: env.core.mongodbUsername,
 *         pass: env.core.mongodbPassword, dbName: env.core.mongodbDbName },
 *
 * Core knows nothing of this key; the augmentation below types it for any
 * app that compiles this package.
 */
export interface MongooseConnectionConfig {
  /** `mongodb://host:port[/db]` or `mongodb+srv://…`. Required to connect. */
  uri: string;
  user?: string;
  pass?: string;
  /** Overrides the database named in `uri`, if any. */
  dbName?: string;
}

declare module "@tulipes/core/config" {
  interface GlobalConfig {
    mongoose?: Partial<MongooseConnectionConfig>;
  }
}

/** The key, spelled the way a boot report names it. */
export const CONNECTION_CONFIG = "config.mongoose.uri";

export interface ReadConnectionConfigResult {
  uri: string;
  /** What `createConnection(uri, options)` takes besides the URI. */
  options: Pick<ConnectOptions, "user" | "pass" | "dbName">;
}

/**
 * Reached only when the app declared one of this package's providers, so a
 * missing URI is a contradiction the boot refuses, naming the key to wire.
 * An empty string counts as missing: an unset variable with `default: ""`
 * is how an optional part arrives.
 */
export function readConnectionConfig(
  ctx: Pick<Ctx, "config">,
  providerName: string,
  report: BootReport,
): ReadConnectionConfigResult | undefined {
  const config = ctx.config.mongoose ?? {};
  if (!config.uri) {
    report.add({
      scope: "providers",
      message:
        `provider "${providerName}" is selected but ${CONNECTION_CONFIG} is not set — ` +
        `wire it in config/app.config.ts from a variable a sys module declares: mongoose: { uri: env.core.mongodbUri }`,
    });
    return undefined;
  }
  return {
    uri: config.uri,
    options: {
      ...(config.user && { user: config.user }),
      ...(config.pass && { pass: config.pass }),
      ...(config.dbName && { dbName: config.dbName }),
    },
  };
}
