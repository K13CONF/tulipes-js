import type { AppConfigFn } from "@tulipes/core/boot";

/**
 * ── The app-wide config seed ──────────────────────────────────────────
 *
 * Runs FIRST in boot phase 6, before any module.config.ts factory, and
 * whatever it returns becomes the base of the global config. Modules read
 * it through `ctx.config.<key>` — see `modules/users/routes`, which
 * clamps page size with the shared pagination bounds.
 *
 * The framework reads exactly ONE field: `app.name`, which titles the
 * startup banner. Everything else here is convention — your keys, read by
 * your modules. Rename, delete, invent freely.
 *
 * Config belonging to ONE feature does not go here; it goes in that
 * module's `module.config.ts`, where `tulipes sync` types it for you
 * (that is where `users.maxSessions` and `users.signupMode` live). This
 * file is for values two or more modules share.
 *
 * Infra connection strings (MONGO_URI, REDIS_URL) are deliberately absent:
 * core reads those straight from the variable store, and duplicating them
 * here would create a second source of truth. The same goes for secrets —
 * declare them `"type": "secret"` in meta.variables.json so they stay
 * redacted in logs and the banner, and read them where they are used.
 */

// `satisfies` (not a type annotation) so TypeScript keeps the exact shape
// of this object for the augmentation at the bottom of the file.
const appConfig = ((Environment) => ({
  /**
   * Identity. `name` is the one field core consumes (the banner reads it);
   * the rest is yours — a /health payload, behaviour switched on `env`.
   */
  app: {
    name: "tulipes-example",
    version: "0.1.0",
    description: "Reference application for @tulipes/core",
    // development | staging | production | test — resolved from APP_ENV
    env: Environment.appEnv,
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
   * HTTP behaviour. Consumed by the sys security module, so the hardening
   * stack is tuned from here rather than by editing that module.
   */
  http: {
    // true behind nginx / a load balancer, so req.ip is the real client
    trustProxy: false,
    requestTimeout: 30,
    // NB: neither the CORS origins nor the body limit are here. Both
    // differ per deployment, so they belong to the env contract
    // (CORS_ORIGINS, BODY_LIMIT — declared in the security module) — one
    // source of truth per value. Shared policy lives in this file;
    // deployment-varying values live in meta.variables.json.
  },

  /**
   * List-endpoint defaults, so every module paginates identically and no
   * caller can ask for ten thousand rows. → modules/users/routes
   */
  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
  },

  /**
   * Cross-cutting security knobs. Note what is NOT here: JWT_SECRET stays
   * in the variable store as a `secret`, never copied into config.
   */
  security: {
    accessTokenTtl: 900, // 15 minutes
    refreshTokenTtl: 2_592_000, // 30 days
    passwordRounds: 12,
    rateLimit: { windowSeconds: 60, max: 100 },
  },

  /**
   * Public-facing URLs. Anything building a link a human clicks — reset
   * emails, webhooks, OAuth redirects — reads these instead of guessing a
   * host from the incoming request. Env-driven, since PORT is declared.
   */
  urls: {
    // Built from PUBLIC_DOMAIN so links generated in production — reset
    // emails, webhook callbacks — point at the real host instead of a
    // localhost URL that is broken everywhere but this machine. The
    // "localhost" sentinel is what separates the two cases.
    api:
      Environment.get("PUBLIC_DOMAIN") === "localhost"
        ? `http://localhost:${Environment.get("PORT")}`
        : `https://${Environment.get("PUBLIC_DOMAIN")}`,
    frontend: "http://localhost:5173",
  },

  /**
   * Shared upload constraints for any module accepting files.
   */
  uploads: {
    maxSizeMb: 10,
    allowedMimeTypes: ["image/png", "image/jpeg", "application/pdf"],
  },

  /**
   * Feature flags — cheap way to ship dark code: a module checks the flag
   * before mounting a route. Drive them from declared boolean variables
   * when they need to differ per environment.
   */
  features: {
    signup: true,
    maintenanceMode: false,
  },

  /**
   * Localization defaults for modules rendering text (emails, errors).
   */
  i18n: {
    defaultLocale: "en",
    supportedLocales: ["en", "fr"],
  },
})) satisfies AppConfigFn;

export default appConfig;

/**
 * Types these keys at every call site: `config.pagination!.maxLimit` is a
 * number, not `unknown`. `tulipes sync` does this automatically for
 * module.config.ts factories; the app-level seed types itself here.
 * Partial because the config object is empty until this factory runs.
 */
declare module "@tulipes/core/config" {
  interface GlobalConfig extends Partial<ReturnType<typeof appConfig>> {}
}
