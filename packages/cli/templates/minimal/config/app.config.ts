import type { AppConfigFn } from "@tulipes/core/boot";

/**
 * App-wide values that belong to no module. `api.prefix` is where a router
 * a routes file returns is mounted; `app.name` titles the startup banner;
 * `timezone.default` is the zone instants are read in (requests may ask for
 * another with `?tz=` or X-Timezone) and, from boot on, the process zone.
 *
 * `env` is every module's environment values — here `env.core.port`, from
 * the `PORT` the core module declares in its package.json — and this is
 * where they are wired to what core reads: `server.port`. A module reads
 * its own values as `ctx.config.<module>.<name>` without any wiring.
 */
const appConfig = ((env) => ({
  app: { name: "tulipes-example" },
  api: { prefix: "/api/v1" },
  server: { port: env.core.port },
  timezone: { default: "UTC" },
})) satisfies AppConfigFn;

export default appConfig;

/** `server` is left out: core already types the key it reads. */
declare module "@tulipes/core/config" {
  interface GlobalConfig extends Partial<Omit<ReturnType<typeof appConfig>, "server">> {}
}
