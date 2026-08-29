import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ModuleManifest } from "./manifest.js";

/**
 * Boot phase 5: given the sorted module list, resolve every conventional file
 * the loaders will consume — paths only, nothing is imported yet. Importing
 * happens later, phase by phase, so a broken routes file can't take down the
 * environment report, and models load before routes exactly as the pipeline
 * dictates.
 *
 * Missing directories and files are simply features a module doesn't use —
 * never an error. The explorer has no failure modes by design.
 */

export type SourceExtension = ".ts" | ".js";

/**
 * In dev the app runs straight from TypeScript (via tsx) so conventions
 * resolve to .ts files; a compiled deployment runs .js. Crucially the
 * verdict must describe the APP's files, never core's own compilation —
 * the published core is always .js while the app it boots is usually .ts.
 *
 * Heuristic fallback (no module dirs to probe): the entry script's
 * extension, then core's own file. The URL alone isn't trustworthy there:
 * tsx's tsImport presents modules under a .js URL while only the .ts
 * source exists on disk, so a .js verdict is confirmed against the disk.
 */
export function detectSourceExtension(): SourceExtension {
  const entry = process.argv[1];
  if (entry?.endsWith(".ts") || entry?.endsWith(".mts")) return ".ts";

  const self = fileURLToPath(import.meta.url);
  if (self.endsWith(".ts")) return ".ts";
  if (!existsSync(self) && existsSync(self.replace(/\.js$/, ".ts"))) return ".ts";
  return ".js";
}

/**
 * The authoritative verdict: look at what the modules actually contain.
 * Only when a project has conventional files in BOTH extensions (or none
 * at all) does the runtime heuristic break the tie.
 */
function probeSourceExtension(modules: readonly ModuleManifest[]): SourceExtension {
  let sawTs = false;
  let sawJs = false;

  for (const module of modules) {
    for (const ext of [".ts", ".js"] as const) {
      const hit =
        existsSync(join(module.dir, `module.config${ext}`)) ||
        existsSync(join(module.dir, `module.acl${ext}`)) ||
        COLLECTIONS.some(
          ([, dirName, suffix]) =>
            listWithSuffix(join(module.dir, dirName), suffix + ext).length > 0,
        );
      if (ext === ".ts") sawTs ||= hit;
      else sawJs ||= hit;
    }
    if (sawTs && sawJs) break;
  }

  if (sawTs !== sawJs) return sawTs ? ".ts" : ".js";
  return detectSourceExtension();
}

export interface ModuleFiles {
  module: ModuleManifest;
  /** `module.config.<ext>` — config factory + lifecycle hooks. */
  configFile?: string;
  /** `module.acl.<ext>` — permission grants for this module's resources. */
  aclFile?: string;
  routeFiles: readonly string[];
  modelFiles: readonly string[];
  bootstrapFiles: readonly string[];
  queueFiles: readonly string[];
  socketFiles: readonly string[];
}

/** dir name → file suffix, e.g. routes/users.routes.ts */
const COLLECTIONS = [
  ["routeFiles", "routes", ".routes"],
  ["modelFiles", "models", ".model"],
  ["bootstrapFiles", "bootstrap", ".bootstrap"],
  ["queueFiles", "queues", ".queues"],
  ["socketFiles", "sockets", ".sockets"],
] as const;

export interface ExploreOptions {
  /** Override the runtime detection — used by tooling and tests. */
  sourceExtension?: SourceExtension;
}

export function exploreModules(
  modules: readonly ModuleManifest[],
  options: ExploreOptions = {},
): ModuleFiles[] {
  const ext = options.sourceExtension ?? probeSourceExtension(modules);

  return modules.map((module) => {
    const files: ModuleFiles = {
      module,
      routeFiles: [],
      modelFiles: [],
      bootstrapFiles: [],
      queueFiles: [],
      socketFiles: [],
    };

    const configFile = join(module.dir, `module.config${ext}`);
    if (existsSync(configFile)) files.configFile = configFile;

    const aclFile = join(module.dir, `module.acl${ext}`);
    if (existsSync(aclFile)) files.aclFile = aclFile;

    for (const [key, dirName, suffix] of COLLECTIONS) {
      files[key] = listWithSuffix(join(module.dir, dirName), suffix + ext);
    }

    return files;
  });
}

function listWithSuffix(dir: string, suffix: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // directory absent — the module doesn't use this feature
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => join(dir, entry.name))
    .sort(); // deterministic order within a module
}
