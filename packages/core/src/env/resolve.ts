import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseDotenv } from "dotenv";

import type { AppEnv } from "../boot/app-env.ts";
import type { BootReport } from "../errors/boot-error.ts";
import type { ModuleManifest } from "../modules/manifest.ts";
import { coerceValue } from "./coerce.ts";
import { ResolvedEnv, type ResolvedVariable, type VariableSource } from "./resolved.ts";
import type { VariableValue } from "./spec.ts";

/**
 * Boot phase 1 — give every declared variable its value.
 *
 * Precedence, highest first:
 *
 *   process.env  >  .envs/.env.<APP_ENV>  >  the declaration's default
 *
 * A container-injected value must always win, so the file never overrides
 * the process. The file is optional: production containers typically inject
 * everything and ship no `.env` at all.
 *
 * Every problem is collected into the report and thrown once, so an operator
 * sees the whole list rather than one variable per restart.
 */

export interface ResolveEnvOptions {
  appEnv: AppEnv;
  /** Where the `.env.<APP_ENV>` files live; `<root>/.envs` by default. */
  envsDir: string;
  /**
   * Inspection: `tulipes routes` and `tulipes spec` must run without a
   * `.env` or a secret, so nothing is required and an invalid value is not
   * an error — such a variable is simply absent. The file is still read,
   * so `config/app.config.ts` wires real values where they exist.
   */
  lenient?: boolean;
}

export function resolveEnv(
  manifests: readonly ModuleManifest[],
  options: ResolveEnvOptions,
  report: BootReport,
): ResolvedEnv {
  const fileValues = readEnvFile(join(options.envsDir, `.env.${options.appEnv}`));
  const resolved: ResolvedVariable[] = [];
  // Every variable has exactly one owning module: shared infrastructure
  // variables (PORT, MONGO_URI…) belong to the sys core module, everyone
  // else reads them through the config.
  const owners = new Map<string, string>();

  for (const manifest of manifests) {
    for (const [configKey, spec] of Object.entries(manifest.env)) {
      const owner = owners.get(spec.key);
      if (owner) {
        report.add({
          scope: "env",
          module: manifest.name,
          message: `variable "${spec.key}" is already declared by module "${owner}" — one owner per variable`,
        });
        continue;
      }
      owners.set(spec.key, manifest.name);

      const lookup = lookupRaw(spec.key, fileValues, spec.default);
      const entry: ResolvedVariable = { module: manifest.name, configKey, spec, value: undefined, source: lookup?.source };

      if (!lookup) {
        if (spec.required && !options.lenient) {
          report.add({ scope: "env", module: manifest.name, message: `required variable "${spec.key}" has no value (${spec.description})` });
        }
        // Optional and absent: legitimately undefined.
        resolved.push(entry);
        continue;
      }

      const coerced = coerceValue(spec, lookup.raw);
      if (coerced.ok) {
        resolved.push({ ...entry, value: coerced.value });
      } else {
        if (!options.lenient) report.add({ scope: "env", module: manifest.name, message: `variable "${spec.key}": ${coerced.reason}` });
        resolved.push(entry);
      }
    }
  }

  return new ResolvedEnv(resolved);
}

/** The winning raw value and where it came from, or undefined when no source has one. */
function lookupRaw(
  key: string,
  fileValues: Record<string, string>,
  fallback: VariableValue | undefined,
): { raw: VariableValue; source: VariableSource } | undefined {
  if (process.env[key] !== undefined) return { raw: process.env[key], source: "process.env" };
  if (fileValues[key] !== undefined) return { raw: fileValues[key], source: "file" };
  if (fallback !== undefined) return { raw: fallback, source: "default" };
  return undefined;
}

/** The file's values are never written into `process.env`: the process must keep winning. */
function readEnvFile(filePath: string): Record<string, string> {
  try {
    return parseDotenv(readFileSync(filePath, "utf8"));
  } catch {
    return {}; // a missing file is a valid deployment
  }
}
