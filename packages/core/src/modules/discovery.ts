import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BootReport } from "../errors/boot-error.js";
import { tulipesManifestSchema, type ModuleManifest } from "./manifest.js";

/**
 * Read each module's package.json (under `modules/<name>`) into a manifest.
 * Modules are yarn
 * workspace packages, so a folder without a package.json is a broken module,
 * not an ignorable one. As everywhere at boot: problems are collected into
 * the report, never thrown one-by-one.
 */
export function discoverModules(
  modulesDir: string,
  report: BootReport,
): ModuleManifest[] {
  let entries;
  try {
    entries = readdirSync(modulesDir, { withFileTypes: true });
  } catch {
    report.add({
      scope: "modules",
      message: `modules directory not found: ${modulesDir}`,
    });
    return [];
  }

  const manifests: ModuleManifest[] = [];
  const seen = new Map<string, string>(); // short name → package name

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const dir = join(modulesDir, entry.name);
    const manifest = readManifest(dir, entry.name, report);
    if (!manifest) continue;

    // Short names must be unique: they are the dependsOn address space.
    // Two scopes owning the same segment (@a/users, @b/users) would make
    // "dependsOn: [users]" ambiguous.
    const clash = seen.get(manifest.name);
    if (clash) {
      report.add({
        scope: "modules",
        module: manifest.name,
        message: `short name "${manifest.name}" is claimed by both "${clash}" and "${manifest.packageName}"`,
      });
      continue;
    }
    seen.set(manifest.name, manifest.packageName);
    manifests.push(manifest);
  }

  return manifests;
}

function readManifest(
  dir: string,
  folder: string,
  report: BootReport,
): ModuleManifest | undefined {
  let json: { name?: unknown; tulipes?: unknown };
  try {
    json = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch (error) {
    report.add({
      scope: "modules",
      module: folder,
      message: `package.json missing or invalid: ${(error as Error).message}`,
    });
    return undefined;
  }

  if (typeof json.name !== "string" || json.name.length === 0) {
    report.add({
      scope: "modules",
      module: folder,
      message: `package.json has no "name" — modules must be workspace packages`,
    });
    return undefined;
  }

  // Absent "tulipes" key is a valid module with default ordering.
  const parsed = tulipesManifestSchema.safeParse(json.tulipes ?? {});
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      report.add({
        scope: "modules",
        module: folder,
        message: `package.json "tulipes" key: ${issue.path.join(".") || "(root)"} — ${issue.message}`,
      });
    }
    return undefined;
  }

  const shortName = json.name.split("/").at(-1)!;
  return {
    name: shortName,
    packageName: json.name,
    dir,
    ...parsed.data,
  };
}
