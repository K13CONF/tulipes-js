import type { AppConfigFn } from "@tulipes/core/boot";

/**
 * ── The app-wide config seed ──────────────────────────────────────────
 *
 * Runs FIRST in boot phase 6, before any module.config.ts factory, and
 * whatever it returns becomes the base of the global config. Modules read
 * it through `ctx.config.<key>`.
 *
 * Add a key here when two or more modules share a value. Config belonging
 * to ONE feature goes in that module's `module.config.ts` instead, where
 * `yarn sync` types it for you — that is where `users.maxSessions` and
 * `users.signupMode` live. A value that differs per deployment belongs in
 * neither: declare it in a module's `meta.variables.json` and read it with
 * `Environment.get`, the way MONGO_URI, CORS_ORIGINS and BODY_LIMIT do.
 *
 * The framework reads exactly one field of this object: `app.name`, which
 * titles the startup banner. Everything else is yours.
 */

// `satisfies` (not a type annotation) so TypeScript keeps the exact shape
// of this object for the augmentation at the bottom of the file.
const appConfig = (() => ({
  app: {
    name: "tulipes-example",
  },

  /**
   * Route prefixing. Modules build paths from this instead of hardcoding
   * "/api/v1", so versioning the whole API is a one-line change:
   * `router.get(`${config.api!.prefix}/users`, …)`.
   */
  api: {
    prefix: "/api/v1",
    docsPath: "/api/docs",
  },

  /**
   * List-endpoint defaults, so every module paginates identically and no
   * caller can ask for ten thousand rows. → modules/users/routes
   */
  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
  },
})) satisfies AppConfigFn;

export default appConfig;

/**
 * Types these keys at every call site: `config.pagination!.maxLimit` is a
 * number, not `unknown`. `yarn sync` does this automatically for
 * module.config.ts factories; the app-level seed types itself here.
 * Partial because the config object is empty until this factory runs.
 */
declare module "@tulipes/core/config" {
  interface GlobalConfig extends Partial<ReturnType<typeof appConfig>> {}
}
