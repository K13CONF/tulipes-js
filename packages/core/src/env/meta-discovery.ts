import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BootReport } from "../errors/boot-error.js";
import { metaFileSchema, type VariableSpec } from "./spec.js";

export const META_FILENAME = "meta.variables.json";

export interface ModuleMeta {
  /** Folder name under modules/ — enough for attribution at this phase. */
  module: string;
  filePath: string;
  variables: VariableSpec[];
}

/**
 * Walk `modules/*` and load every module's env contract.
 *
 * A module without a meta file simply declares no variables — that's valid,
 * not an error. Malformed files, on the other hand, are collected into the
 * report (never thrown one-by-one) so the developer sees all of them at once.
 */
export function discoverModuleMeta(
  modulesDir: string,
  report: BootReport,
): ModuleMeta[] {
  let entries;
  try {
    entries = readdirSync(modulesDir, { withFileTypes: true });
  } catch {
    report.add({
      scope: "env",
      message: `modules directory not found: ${modulesDir}`,
    });
    return [];
  }

  const metas: ModuleMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const module = entry.name;
    const filePath = join(modulesDir, module, META_FILENAME);

    let text: string;
    try {
      text = readFileSync(filePath, "utf8");
    } catch {
      continue; // no meta file — module needs no env variables
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      report.add({
        scope: "env",
        module,
        message: `${META_FILENAME} is not valid JSON: ${(error as Error).message}`,
      });
      continue;
    }

    const parsed = metaFileSchema.safeParse(json);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        report.add({
          scope: "env",
          module,
          message: `${META_FILENAME}: ${issue.message}`,
        });
      }
      continue;
    }

    metas.push({ module, filePath, variables: parsed.data.variables });
  }

  return metas;
}
