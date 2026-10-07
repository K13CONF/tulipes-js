import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BootReport } from "../errors/boot-error.js";
import { derivedDependsOn, tulipesManifestSchema, type ModuleManifest } from "./manifest.js";

/**
 * What a module keeps at its root: its manifest, its settings declaration
 * and its grants. Everything else has a folder, so the shape of every
 * module reads the same way. Documentation and dotfiles are ignored.
 */
const ROOT_FILES = /^(package\.json|module\.config\.[cm]?[jt]s|module\.acl\.[cm]?[jt]s)$/;
const ROOT_HINTS: Record<string, string> = {
  "meta.variables.json": "its variables moved to package.json under tulipes.env",
  "index.ts": "its public exports live in lib/index.ts, pointed at by package.json \"exports\"",
  "index.js": "its public exports live in lib/index.js, pointed at by package.json \"exports\"",
  "schemas.ts": "request schemas live in schemas/<module>.schemas.ts",
  "schemas.js": "request schemas live in schemas/<module>.schemas.js",
};

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
    checkRoot(dir, manifest.name, report);

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
  const manifestKey = json.tulipes ?? {};
  if (typeof manifestKey === "object" && manifestKey !== null && "offline" in manifestKey) {
    report.add({
      scope: "modules",
      module: folder,
      message: `package.json "tulipes.offline" is gone — every module is inspectable; routes files are plain (ctx) => Router functions`,
    });
    return undefined;
  }
  const parsed = tulipesManifestSchema.safeParse(manifestKey);
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
    dependsOn: derivedDependsOn(json.name, parsed.data.dependsOn, (json as { dependencies?: Record<string, string> }).dependencies),
  };
}

function checkRoot(dir: string, module: string, report: BootReport): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith(".") || entry.name.endsWith(".md") || ROOT_FILES.test(entry.name)) continue;
    const hint = ROOT_HINTS[entry.name] ?? "a module's root holds package.json, module.config and module.acl; everything else has a folder (routes/, controllers/, models/, schemas/, helpers/, bootstrap/, queues/, sockets/, i18n/, agent/, lib/, tests/)";
    report.add({ scope: "modules", module, message: `${entry.name} does not belong at the module root — ${hint}` });
  }
}
