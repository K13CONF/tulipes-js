import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { BootReport } from "../errors/boot-error.ts";
import { variableSpecSchema, type VariableSpec } from "./spec.ts";

/** Where a module declared its variables before 0.11; its presence is an error naming the move. */
export const LEGACY_META_FILENAME = "meta.variables.json";

export interface ModuleMeta {
  /** Folder name under modules/ — enough for attribution at this phase. */
  module: string;
  /** The module's package.json, where `tulipes.env` lives. */
  filePath: string;
  variables: VariableSpec[];
}

/**
 * Only the part of the manifest this phase needs. The module graph reads
 * the whole `tulipes` key later and validates it strictly; here anything
 * else is left alone so an ordering mistake is reported once, by the
 * phase that owns it.
 */
const envOnly = z.object({ tulipes: z.object({ env: z.array(variableSpecSchema).default([]) }).passthrough().optional() }).passthrough();

/**
 * Walk `modules/*` and load every module's env contract from its
 * package.json (`tulipes.env`).
 *
 * A module without the key simply declares no variables — that's valid,
 * not an error. Malformed entries are collected into the report (never
 * thrown one-by-one) so the developer sees all of them at once.
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
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const module = entry.name;
    const filePath = join(modulesDir, module, "package.json");

    if (existsSync(join(modulesDir, module, LEGACY_META_FILENAME))) {
      report.add({
        scope: "env",
        module,
        message: `${LEGACY_META_FILENAME} moved to package.json under "tulipes": { "env": [...] } — same entries, one file fewer (tulipes migrate 0.11 moves it)`,
      });
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      continue; // no manifest or an invalid one: the module graph reports it
    }

    const parsed = envOnly.safeParse(json);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        report.add({
          scope: "env",
          module,
          message: `package.json tulipes.env: ${issue.message}`,
        });
      }
      continue;
    }

    const variables = parsed.data.tulipes?.env ?? [];
    if (variables.length > 0) metas.push({ module, filePath, variables });
  }

  return metas;
}
