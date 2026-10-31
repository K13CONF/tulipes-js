import type { AppConfigFn } from "@tulipes/core/boot";

/**
 * ── The app-wide config seed ──────────────────────────────────────────
 *
 * Runs FIRST in boot phase 4, before any module's settings are loaded, and
 * whatever it returns becomes the base of the global config. Modules read
 * it through `ctx.config.<key>`.
 *
 * It receives `env`: every module's environment values, resolved from the
 * container, `.envs/.env.<APP_ENV>` and the defaults each module declares
 * in its package.json `tulipes.env` — `env.core.port`, `env.auth.adminEmail`
 * — typed by `pnpm sync`. This is the one place the environment is wired
 * to what the framework and the providers read: `server.port` for core,
 * `mongoose.*` for @tulipes/mongoose, `bullmq.redisUrl` for @tulipes/bullmq.
 * Modules never need this wiring: each reads its own values as
 * `ctx.config.<module>.<name>`, beside its settings.
 *
 * Add a key here when two or more modules share a value. Config belonging
 * to ONE feature goes in that module's `module.config.ts` instead, where
 * `pnpm sync` types it for you — that is where `users.maxSessions` and
 * `users.signupMode` live. A value that differs per deployment belongs in
 * neither: declare it under `tulipes.env` in a module's package.json and
 * read it as `ctx.config.<module>.<name>`, the way MONGO_URI and REDIS_URL
 * are declared by the core module.
 *
 * Under inspection (`tulipes routes`, `tulipes spec`) a value that is
 * missing or invalid is `undefined` rather than an error, so this file
 * only wires values and never requires one.
 */

// `satisfies` (not a type annotation) so TypeScript keeps the exact shape
// of this object for the augmentation at the bottom of the file.
const appConfig = ((env) => ({
  app: {
    name: "tulipes-example",
  },

  /**
   * Route prefixing. A router a routes file returns is mounted under this
   * prefix, so versioning the whole API is a one-line change here; a module
   * that wants another path says so with `ctx.routes.mount(router, "/x")`.
   */
  api: {
    prefix: "/api/v1",
  },

  /** What core listens on. */
  server: {
    port: env.core.port,
  },

  /**
   * How @tulipes/mongoose reaches MongoDB. A full MONGO_URI wins — it is the
   * only way to name a replica set, an Atlas cluster or driver options;
   * otherwise the host, credentials and database name are handed to the
   * driver separately, so nothing is URL-encoded by hand.
   */
  mongoose: env.core.mongodbUri
    ? { uri: env.core.mongodbUri }
    : {
        uri: env.core.mongodbHost,
        user: env.core.mongodbUsername,
        pass: env.core.mongodbPassword,
        dbName: env.core.mongodbDbName,
      },

  /** How @tulipes/bullmq reaches Redis. */
  bullmq: {
    redisUrl: env.core.redisUrl,
  },

  /**
   * The languages this app speaks. Every module owns its own strings in
   * `modules/<name>/i18n/<locale>.json` — the module is the namespace —
   * and `req.t` inside an endpoint is already bound to the module that
   * declared it. A request picks its locale with `?lang=fr` or an
   * Accept-Language header, narrowed to this list.
   *
   * `defaultLocale` is also the fallback: a key missing from fr.json is
   * served from en.json, and outside production the gap is recorded in
   * `fr.missing.json` next to it.
   */
  i18n: {
    defaultLocale: "en",
    supportedLocales: ["en", "fr"],
  },

  /**
   * How instants are read. Dates are stored and returned as UTC; a zone is
   * what "today", "02:00" and a timestamp in an email mean. A request picks
   * its own with `?tz=Europe/Paris` or an X-Timezone header (narrowed to
   * `supported` when you list it), and handlers read it as `req.timezone`
   * with helpers on `req.time`; code with no request uses `ctx.time`.
   *
   * `default` is also the zone of cron patterns given to `ctx.queues`, and
   * — unless `applyToProcess: false` — the process zone, so log times,
   * daily log rotation and `Date#getHours()` agree with it.
   */
  timezone: {
    default: "UTC",
  },

  /**
   * List-endpoint defaults, so every module paginates identically and no
   * caller can ask for ten thousand rows. → modules/users/routes
   */
  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
    /** Ceiling for one list query (find, count or aggregate); see @app/core's query helpers. */
    maxTimeMs: 5_000,
  },
})) satisfies AppConfigFn;

export default appConfig;

/**
 * Types these keys at every call site: `config.pagination!.maxLimit` is a
 * number, not `unknown`. `pnpm sync` does this automatically for
 * module.config.ts factories; the app-level seed types itself here.
 * Partial because the config object is empty until this factory runs.
 * `server`, `mongoose` and `bullmq` are left out: core and the providers
 * already type the keys they read.
 */
declare module "@tulipes/core/config" {
  interface GlobalConfig extends Partial<Omit<ReturnType<typeof appConfig>, "server" | "mongoose" | "bullmq">> {}
}
