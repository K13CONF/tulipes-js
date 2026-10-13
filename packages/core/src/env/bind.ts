import type { GlobalConfig } from "../config/index.ts";
import type { BootReport } from "../errors/boot-error.ts";
import type { ResolvedEnv } from "./resolved.ts";

/**
 * Boot phase 6b — put every environment value where its module reads it:
 * `ctx.config.<module>.<name>`, beside the module's settings.
 *
 * Each value is defined as a getter that is **read-only** and
 * **non-enumerable**. Read-only because a deployment value is not something
 * code changes at runtime, and assigning to one throws (ESM is strict), the
 * way writing an undeclared variable threw before. Non-enumerable so that
 * nothing that walks the namespace sees it: `{ ...ctx.config.auth }`,
 * `JSON.stringify`, `Object.keys` and so the settings store all skip it,
 * which is what keeps a secret out of `GET /config` and out of a settings
 * file. The settings manager replaces a namespace object once, before this
 * phase, and afterwards assigns into it in place, so the getters survive
 * every settings write.
 *
 * Under inspection the getter throws instead: `tulipes routes` must never
 * depend on a value, and a routes file that reads one while building —
 * rather than inside a handler — is told so by name.
 */

export interface BindEnvOptions {
  inspecting: boolean;
}

export function bindEnvValues(
  config: GlobalConfig,
  resolved: ResolvedEnv,
  options: BindEnvOptions,
  report: BootReport,
): void {
  for (const { module, configKey, value } of resolved.entries) {
    // A module with no settings has no namespace yet; it gets one here.
    const namespace = (config[module] ??= {}) as Record<string, unknown>;

    // The settings schema's output owns every enumerable key of the
    // namespace at this point, so a clash is a field named twice.
    if (Object.prototype.hasOwnProperty.call(namespace, configKey)) {
      report.add({
        scope: "env",
        module,
        message: `config.${module}.${configKey} is both a setting (module.config.ts) and an environment value (package.json tulipes.env) — rename one`,
      });
      continue;
    }

    Object.defineProperty(namespace, configKey, {
      enumerable: false,
      configurable: false,
      get: options.inspecting
        ? () => {
            throw new Error(
              `config.${module}.${configKey} is an environment value, not available during inspection — read it inside a handler or a bootstrap, not while building routes`,
            );
          }
        : () => value,
    });
  }
}
