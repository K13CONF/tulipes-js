import type { AppConfigFn } from "@tulipes/core/boot";

/**
 * App-wide values that belong to no module. `api.prefix` is where a router
 * a routes file returns is mounted; `app.name` titles the startup banner.
 */
const appConfig = (() => ({
  app: { name: "tulipes-example" },
  api: { prefix: "/api/v1" },
})) satisfies AppConfigFn;

export default appConfig;

declare module "@tulipes/core/config" {
  interface GlobalConfig extends Partial<ReturnType<typeof appConfig>> {}
}
