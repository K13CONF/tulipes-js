import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { appCoreVersion, cliVersion, packageRoot } from "./package-info.ts";

const PACKAGE = "@tulipes/core";
const CLI = "@tulipes/cli";
const REGISTRY = "https://registry.npmjs.org";

interface Manifest {
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * `tulipes update` — move to the latest published CLI and core.
 *
 * There are two things that can be out of date, and they are genuinely
 * separate installs:
 *
 *   the CLI    the globally installed `tulipes` on your PATH (@tulipes/cli)
 *   the app    @tulipes/core in the app root and in every module, since
 *              modules are workspace packages that declare it themselves,
 *              plus every other @tulipes package the app declares — the
 *              CLI devDependency, spec, testing, the providers
 *
 * The packages are released in lockstep (docs/releasing.md), so each one's
 * `latest` is the version paired with core's `latest`: raising core alone
 * would leave a provider whose peer range refuses the new core.
 *
 * Updating only the app leaves you typing an old CLI against a new
 * framework; updating only the CLI leaves the app behind. This does both,
 * and either alone when only one applies — so it is also useful outside an
 * app, where it upgrades just the CLI.
 */
export async function runUpdate(rootDir: string): Promise<void> {
  const current = cliVersion();

  const manifests = findManifests(rootDir);
  const rootManifest = join(rootDir, "package.json");
  const targets = [...new Set([PACKAGE, CLI, ...declaredPackages([...manifests.map(({ path }) => path), rootManifest])])];

  // Every version is known before any manifest is written, so a registry
  // failure halfway through leaves the app as it was.
  let versions: Map<string, string>;
  try {
    versions = new Map(await Promise.all(targets.map(async (name) => [name, await fetchLatest(name)] as const)));
  } catch (error) {
    console.error(`could not reach the npm registry: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  const latest = versions.get(PACKAGE)!;
  const latestCli = versions.get(CLI)!;

  const cliRoot = packageRoot();
  // Updatable-as-a-CLI means: an installed package (it lives under some
  // node_modules) that is NOT this app's own copy — the app's copy is
  // covered by the dependency update below. A source checkout matches
  // neither and is left alone, since git owns its version, not npm.
  const cliIsGlobal =
    !cliRoot.startsWith(resolve(rootDir) + sep) &&
    cliRoot.includes(`${sep}node_modules${sep}`);

  let didSomething = false;

  if (cliIsGlobal) {
    didSomething = true;
    // `latest` can be behind a candidate installed from `next`; an update
    // never moves backwards.
    if (atOrAhead(current, latestCli)) {
      console.log(`cli already on ${current}${current === latestCli ? "" : ` (latest is ${latestCli})`}`);
    } else {
      await updateGlobalCli(cliRoot, current, latestCli);
    }
  }

  if (manifests.length > 0) {
    didSomething = true;
    // The app's installed version, not the CLI's — they are separate
    // installs, and reporting one as the other is how this whole confusion
    // started.
    await updateApp(rootDir, manifests, appCoreVersion(rootDir), versions);
  }

  if (!didSomething) {
    console.error(
      `no package.json in ${rootDir} depends on ${PACKAGE}, and this CLI is not a global install — run it from an app root`,
    );
    process.exitCode = 1;
  }
}

/**
 * Reinstalls the global CLI into the prefix it already lives in.
 *
 * That prefix matters: with a version manager, `npm install -g` installs
 * for whichever node is *active*, which may not be the one whose bin
 * directory holds the `tulipes` on your PATH. Deriving the prefix from the
 * running CLI's own location updates the binary you actually type.
 */
async function updateGlobalCli(
  cliRoot: string,
  current: string,
  latest: string,
): Promise<void> {
  console.log(`cli: ${current} → ${latest}`);

  const prefix = globalPrefixOf(cliRoot);
  const args = ["install", "-g", ...(prefix ? ["--prefix", prefix] : []), `${CLI}@${latest}`];

  const code = await run("npm", args, cliRoot);
  if (code !== 0) {
    console.error(
      `\ncould not update the global cli — try: npm install -g ${CLI}@${latest}`,
    );
    process.exitCode = code === -1 ? 1 : code;
    return;
  }
  console.log(`cli updated — the next \`tulipes\` invocation runs ${latest}\n`);
}

/** `<prefix>/lib/node_modules/@tulipes/cli` → `<prefix>`, for npm layouts. */
function globalPrefixOf(cliRoot: string): string | undefined {
  const marker = `${sep}lib${sep}node_modules${sep}`;
  const index = cliRoot.indexOf(marker);
  // pnpm and bun keep globals elsewhere; without a recognisable prefix we
  // let npm pick its own, which is right for a plain npm install.
  return index === -1 ? undefined : cliRoot.slice(0, index);
}

async function updateApp(
  rootDir: string,
  manifests: { path: string }[],
  current: string | undefined,
  versions: Map<string, string>,
): Promise<void> {
  const latest = versions.get(PACKAGE)!;
  const ranges = new Map([...versions].map(([name, version]) => [name, `^${version}`]));
  // The root is rewritten even when only modules depend on core: the app's
  // own CLI devDependency moves with it, so `pnpm dev` and friends keep
  // matching the framework they generate for.
  const root = join(rootDir, "package.json");
  const paths = [...new Set([...(existsSync(root) ? [root] : []), ...manifests.map(({ path }) => path)])];
  const changed = paths.map((path) => ({ path, names: rewrite(path, ranges) })).filter(({ names }) => names.length > 0);

  if (changed.length === 0) {
    console.log(`app already on ${PACKAGE} ${current ?? ranges.get(PACKAGE)}${current && current !== latest ? ` (latest is ${latest})` : ""}`);
    return;
  }

  for (const { path, names } of changed) {
    console.log(`  update ${relative(rootDir, path) || "package.json"}: ${names.map((name) => `${name} ${ranges.get(name)}`).join(", ")}`);
  }
  console.log(`\napp: ${current ?? "not installed"} → ${latest}\n`);

  // Rewriting manifests without installing would leave the app claiming a
  // version it does not have.
  const manager = detectManager(rootDir);
  console.log(`running ${manager} install…\n`);
  const code = await run(manager, ["install"], rootDir);

  if (code === -1) {
    console.error(`\ncould not run "${manager}" — manifests are updated, install manually`);
    process.exitCode = 1;
    return;
  }
  if (code !== 0) {
    process.exitCode = code;
    return;
  }

  warnAboutBreakingChanges(current, latest);
}

/**
 * Minor bumps below 1.0 carry breaking changes in this project, and an app
 * skipping several of them will not boot until each is dealt with. Saying
 * so here — where the jump is actually visible — beats leaving it to be
 * discovered as a stack trace.
 */
function warnAboutBreakingChanges(current: string | undefined, latest: string): void {
  const from = minorOf(current);
  const to = minorOf(latest);
  if (from === undefined || to === undefined || from >= to) return;

  console.log(
    [
      "",
      `This crossed ${to - from} minor version(s), each of which may have`,
      "changed something breaking. Before running the app:",
      "",
      `  https://github.com/kemora13conf/bp-backend-express/blob/v${latest}/packages/core/MIGRATING.md`,
      "",
      "It is ordered oldest-first, because the steps build on each other.",
    ].join("\n"),
  );
}

/** The minor of a 0.x version — 0 for anything already at 1.0 or beyond. */
function minorOf(version: string | undefined): number | undefined {
  if (!version) return undefined;
  const [major, minor] = version.split(".").map(Number);
  return major === 0 && Number.isInteger(minor) ? minor : undefined;
}

async function fetchLatest(name: string): Promise<string> {
  // The scoped name has to be encoded for the registry's document route.
  const response = await fetch(`${REGISTRY}/${name.replace("/", "%2f")}/latest`);
  if (!response.ok) {
    throw new Error(`${name}: registry responded ${response.status}`);
  }
  const body = (await response.json()) as { version?: unknown };
  if (typeof body.version !== "string") {
    throw new Error(`${name}: registry returned no version`);
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

/** Every @tulipes package the manifests declare as a dependency. */
function declaredPackages(paths: string[]): string[] {
  const names = new Set<string>();
  for (const path of paths) {
    let manifest: Manifest;
    try {
      manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
    } catch {
      continue;
    }
    for (const deps of [manifest.dependencies, manifest.devDependencies]) {
      for (const name of Object.keys(deps ?? {})) if (name.startsWith("@tulipes/")) names.add(name);
    }
  }
  return [...names];
}

/**
 * Raises each package to its range wherever the manifest declares it, and
 * returns the names that changed. Only a plain version range (`^x.y.z`,
 * `~x.y.z`, `x.y.z`) whose floor is below the target is rewritten: a floor
 * at or above it is a candidate ahead of `latest`, and anything else —
 * `workspace:*`, `file:`, a compound range — is the app's own choice.
 */
function rewrite(path: string, ranges: Map<string, string>): string[] {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;

  const changed = new Set<string>();
  for (const deps of [manifest.dependencies, manifest.devDependencies]) {
    for (const [name, range] of ranges) {
      const floor = deps?.[name] === undefined ? undefined : floorOf(deps[name]);
      if (deps && floor && compareVersions(floor, floorOf(range)!) < 0) {
        deps[name] = range;
        changed.add(name);
      }
    }
  }
  if (changed.size > 0) writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  return [...changed];
}

/** Resolves to the exit code, or -1 when the command could not be spawned. */
async function run(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise<number>((resolve_) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", () => resolve_(-1));
    child.on("exit", (status) => resolve_(status ?? 1));
  });
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** The lowest version a plain range admits, or undefined for any other range. */
function floorOf(range: string): string | undefined {
  const version = range.trim().replace(/^[\^~]|^=/, "").replace(/^v/, "");
  return VERSION.test(version) ? version : undefined;
}

/** True when `version` is a version at or above `latest`; an unknown version is never ahead. */
function atOrAhead(version: string, latest: string): boolean {
  return VERSION.test(version) && VERSION.test(latest) && compareVersions(version, latest) >= 0;
}

/** Semver precedence: negative, zero or positive as `a` sorts before, with or after `b`. */
export function compareVersions(a: string, b: string): number {
  const [, ...left] = VERSION.exec(a)!;
  const [, ...right] = VERSION.exec(b)!;
  for (let i = 0; i < 3; i++) {
    const difference = Number(left[i]) - Number(right[i]);
    if (difference !== 0) return Math.sign(difference);
  }
  const [preA, preB] = [left[3], right[3]];
  if (preA === undefined || preB === undefined) return preA === preB ? 0 : preA === undefined ? 1 : -1;
  const [idsA, idsB] = [preA.split("."), preB.split(".")];
  for (let i = 0; i < Math.min(idsA.length, idsB.length); i++) {
    const [x, y] = [idsA[i]!, idsB[i]!];
    if (x === y) continue;
    const [numX, numY] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (numX && numY) return Math.sign(Number(x) - Number(y));
    if (numX !== numY) return numX ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return Math.sign(idsA.length - idsB.length);
}

export function detectManager(rootDir: string): "yarn" | "npm" | "pnpm" {
  if (existsSync(join(rootDir, "yarn.lock"))) return "yarn";
  if (existsSync(join(rootDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(rootDir, "package-lock.json"))) return "npm";

  // No lockfile yet (a fresh scaffold): fall back to the pinned manager.
  try {
    const manifest = JSON.parse(
      readFileSync(join(rootDir, "package.json"), "utf8"),
    ) as Manifest;
    const pinned = manifest.packageManager ?? "";
    if (pinned.startsWith("yarn")) return "yarn";
    if (pinned.startsWith("npm")) return "npm";
  } catch {
    // fall through
  }
  return "pnpm";
}
