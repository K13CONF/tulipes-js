import type { AppConfigFn } from "@forgex/core/boot";

/**
 * Seeds the global config BEFORE any module factory runs (phase 6).
 * The place for app-wide values that belong to no single module —
 * module factories can read everything set here.
 */
const appConfig: AppConfigFn = (Environment) => ({
  app: {
    name: "forgex-example",
    env: Environment.appEnv,
  },
});

export default appConfig;
