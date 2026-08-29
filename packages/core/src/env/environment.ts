import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseDotenv } from "dotenv";

import { BootReport } from "../errors/boot-error.js";
import { coerceValue } from "./coerce.js";
import { discoverModuleMeta, type ModuleMeta } from "./meta-discovery.js";
import { VariableStore } from "./variable-store.js";
import type { VariableValue } from "./spec.js";
import type { KnownVariables } from "./index.js";

/** Falls back to the broad VariableValue until codegen narrows the key. */
type Resolved<K extends string> = K extends keyof KnownVariables
  ? KnownVariables[K]
  : VariableValue;

/**
 * APP_ENV drives which .env file loads. It is deliberately NOT NODE_ENV:
 * bundlers and libraries overload NODE_ENV as an optimization flag, so Tulipes
 * keeps its own axis and mirrors a sane NODE_ENV for third-party code.
 */
export const appEnvs = ["development", "staging", "production", "test"] as const;
export type AppEnv = (typeof appEnvs)[number];

export interface EnvironmentOptions {
  /** App root — the directory containing `modules/` and `.envs/`. */
  rootDir: string;
  /** Override the mode; defaults to process.env.APP_ENV, then "development". */
  appEnv?: AppEnv;
  modulesDir?: string;
  envsDir?: string;
}

/**
 * Boot phases 1–3: load the mode's .env file, discover every module's
 * meta.variables.json, resolve each declared variable with precedence
 *
 *   process.env  >  .envs/.env.<APP_ENV>  >  spec default
 *
 * (container-injected values must always win), validate everything, and
 * crash once with the aggregate report if anything is missing or invalid.
 */
export class Environment {
  readonly appEnv: AppEnv;
  readonly store: VariableStore;

  private constructor(appEnv: AppEnv, store: VariableStore) {
    this.appEnv = appEnv;
    this.store = store;
  }

  /**
   * Convenience passthrough: `env.get("PORT")` ≡ `env.store.get("PORT")` —
   * with per-variable types once `tulipes sync` has generated config.d.ts.
   */
  get<K extends string>(name: K): Resolved<K> {
    return this.store.get(name) as Resolved<K>;
  }

  static load(options: EnvironmentOptions): Environment {
    const report = new BootReport();
    const appEnv = Environment.#resolveAppEnv(options.appEnv, report);

    // Mirror NODE_ENV for third-party libs: anything that isn't clearly
    // dev/test should get production-grade behavior from them.
    process.env.NODE_ENV ??=
      appEnv === "development" || appEnv === "test" ? appEnv : "production";

    const envsDir = options.envsDir ?? join(options.rootDir, ".envs");
    const modulesDir = options.modulesDir ?? join(options.rootDir, "modules");

    const fileValues = Environment.#readEnvFile(join(envsDir, `.env.${appEnv}`));
    const metas = discoverModuleMeta(modulesDir, report);

    const store = new VariableStore();
    Environment.#resolveAll(metas, fileValues, store, report);

    report.throwIfAny("environment");
    return new Environment(appEnv, store);
  }

  static #resolveAppEnv(
    override: AppEnv | undefined,
    report: BootReport,
  ): AppEnv {
    const raw = override ?? process.env.APP_ENV ?? "development";
    if ((appEnvs as readonly string[]).includes(raw)) return raw as AppEnv;
    report.add({
      scope: "env",
      message: `APP_ENV "${raw}" is invalid — expected one of: ${appEnvs.join(", ")}`,
    });
    return "development"; // placeholder; the report will crash the boot anyway
  }

  /**
   * A missing file is not an error: production containers typically inject
   * everything through real environment variables and ship no .env at all.
   */
  static #readEnvFile(filePath: string): Record<string, string> {
    try {
      return parseDotenv(readFileSync(filePath, "utf8"));
    } catch {
      return {};
    }
  }

  static #resolveAll(
    metas: ModuleMeta[],
    fileValues: Record<string, string>,
    store: VariableStore,
    report: BootReport,
  ): void {
    // Every variable has exactly one owning module. Shared infra variables
    // (MONGO_URI, PORT…) belong to the sys core module; everyone else reads.
    const owners = new Map<string, string>();

    for (const meta of metas) {
      for (const spec of meta.variables) {
        const existingOwner = owners.get(spec.name);
        if (existingOwner) {
          report.add({
            scope: "env",
            module: meta.module,
            message: `variable "${spec.name}" is already declared by module "${existingOwner}" — one owner per variable`,
          });
          continue;
        }
        owners.set(spec.name, meta.module);

        const raw = process.env[spec.name] ?? fileValues[spec.name] ?? spec.default;

        if (raw === undefined) {
          if (spec.required) {
            report.add({
              scope: "env",
              module: meta.module,
              message: `required variable "${spec.name}" has no value (${spec.description})`,
            });
          }
          // Optional without default: legitimately absent, nothing to store.
          continue;
        }

        const coerced = coerceValue(spec, raw);
        if (!coerced.ok) {
          report.add({
            scope: "env",
            module: meta.module,
            message: `variable "${spec.name}": ${coerced.reason}`,
          });
          continue;
        }

        store.declare_(spec, meta.module, coerced.value);
      }
    }
  }
}
