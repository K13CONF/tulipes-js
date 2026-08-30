import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { coreVersion } from "./package-info.js";

const PACKAGE = "@tulipes/core";
const REGISTRY = "https://registry.npmjs.org";

interface Manifest {
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * `tulipes update` — move the app to the latest published core.
 *
 * The framework is depended on in more than one place: the app root and
 * every module, since modules are workspace packages that declare their
 * own dependencies. Bumping them by hand is the tedium this removes —
 * and a module left behind on an older range is exactly the kind of
 * split-version install that produces baffling type errors.
 */
export async function runUpdate(rootDir: string): Promise<void> {
  const current = coreVersion();

  let latest: string;
  try {
    latest = await fetchLatest();
  } catch (error) {
    console.error(`could not reach the npm registry: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const manifests = findManifests(rootDir);
  if (manifests.length === 0) {
    console.error(
      `no package.json in ${rootDir} depends on ${PACKAGE} — run this from an app root`,
    );
    process.exitCode = 1;
    return;
  }

  const range = `^${latest}`;
  const changed = manifests.filter(({ path }) => rewrite(path, range));

  if (changed.length === 0) {
    console.log(`already on ${PACKAGE}@${range} (installed ${current}, latest ${latest})`);
    return;
  }

  for (const { path } of changed) {
    console.log(`  update ${relative(rootDir, path) || "package.json"} → ${range}`);
  }
  console.log(`\n${PACKAGE}: ${current} → ${latest}\n`);

  await install(rootDir);
}

async function fetchLatest(): Promise<string> {
  // The scoped name has to be encoded for the registry's document route.
  const response = await fetch(`${REGISTRY}/${PACKAGE.replace("/", "%2f")}/latest`);
  if (!response.ok) {
    throw new Error(`registry responded ${response.status}`);
  }
  const body = (await response.json()) as { version?: unknown };
  if (typeof body.version !== "string") {
    throw new Error("registry returned no version");
  }
  return body.version;
}

/** The app root plus every module — anywhere the framework is depended on. */
function findManifests(rootDir: string): { path: string }[] {
  const candidates = [join(rootDir, "package.json")];

  const modulesDir = join(rootDir, "modules");
  try {
    for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        candidates.push(join(modulesDir, entry.name, "package.json"));
      }
    }
  } catch {
    // No modules directory: still a valid target if the root depends on core.
  }

  return candidates
    .filter((path) => existsSync(path) && dependsOnCore(path))
    .map((path) => ({ path }));
}

function dependsOnCore(path: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
    return Boolean(manifest.dependencies?.[PACKAGE] ?? manifest.devDependencies?.[PACKAGE]);
  } catch {
    return false;
  }
}

/** Returns true when the file actually changed. */
function rewrite(path: string, range: string): boolean {
  const raw = readFileSync(path, "utf8");
  const manifest = JSON.parse(raw) as Manifest;

  let touched = false;
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = manifest[field];
    if (deps?.[PACKAGE] !== undefined && deps[PACKAGE] !== range) {
      deps[PACKAGE] = range;
      touched = true;
    }
  }
  if (!touched) return false;

  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  return true;
}

/**
 * Rewriting manifests without installing would leave the app claiming a
 * version it does not have, so the install is part of the command rather
 * than a step to remember.
 */
async function install(rootDir: string): Promise<void> {
  const manager = detectManager(rootDir);
  console.log(`running ${manager} install…\n`);

  const code = await new Promise<number>((resolve) => {
    const child = spawn(manager, ["install"], { cwd: rootDir, stdio: "inherit" });
    child.on("error", () => resolve(-1));
    child.on("exit", (status) => resolve(status ?? 1));
  });

  if (code === -1) {
    console.error(`\ncould not run "${manager}" — manifests are updated, install manually`);
    process.exitCode = 1;
  } else if (code !== 0) {
    process.exitCode = code;
  }
}

function detectManager(rootDir: string): "yarn" | "npm" | "pnpm" {
  if (existsSync(join(rootDir, "yarn.lock"))) return "yarn";
  if (existsSync(join(rootDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(rootDir, "package-lock.json"))) return "npm";

  // No lockfile yet (a fresh scaffold): fall back to the pinned manager.
  try {
    const manifest = JSON.parse(
      readFileSync(join(rootDir, "package.json"), "utf8"),
    ) as Manifest;
    const pinned = manifest.packageManager ?? "";
    if (pinned.startsWith("pnpm")) return "pnpm";
    if (pinned.startsWith("npm")) return "npm";
  } catch {
    // fall through
  }
  return "yarn";
}
