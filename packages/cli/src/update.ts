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
 *              plus the app's own @tulipes/cli devDependency
 *
 * Provider packages (@tulipes/mongoose, /bullmq, /socket.io) follow their
 * own lines and are not rewritten here; MIGRATING.md lists the pairing.
 *
 * Updating only the app leaves you typing an old CLI against a new
 * framework; updating only the CLI leaves the app behind. This does both,
 * and either alone when only one applies — so it is also useful outside an
 * app, where it upgrades just the CLI.
 */
export async function runUpdate(rootDir: string): Promise<void> {
  const current = cliVersion();

  let latest: string;
  let latestCli: string;
  try {
    [latest, latestCli] = await Promise.all([fetchLatest(PACKAGE), fetchLatest(CLI)]);
  } catch (error) {
    console.error(`could not reach the npm registry: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

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

  const manifests = findManifests(rootDir);
  if (manifests.length > 0) {
    didSomething = true;
    // The app's installed version, not the CLI's — they are separate
    // installs, and reporting one as the other is how this whole confusion
    // started.
    await updateApp(rootDir, manifests, appCoreVersion(rootDir), latest, latestCli);
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
  latest: string,
  latestCli: string,
): Promise<void> {
  const range = `^${latest}`;
  const changed = manifests.filter(({ path }) => rewrite(path, range));
  // The app's own CLI devDependency moves with it, so `pnpm dev` and friends
  // keep matching the framework they generate for.
  const root = join(rootDir, "package.json");
  if (existsSync(root) && rewrite(root, `^${latestCli}`, CLI) && !changed.some(({ path }) => path === root)) changed.push({ path: root });

  if (changed.length === 0) {
    console.log(`app already on ${PACKAGE} ${current ?? range}${current && current !== latest ? ` (latest is ${latest})` : ""}`);
    return;
  }

  for (const { path } of changed) {
    console.log(`  update ${relative(rootDir, path) || "package.json"} → ${range}`);
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

/**
 * Raises `name` to `range` wherever the manifest declares it; returns true
 * when the file actually changed. Only a plain version range (`^x.y.z`,
 * `~x.y.z`, `x.y.z`) whose floor is below the target is rewritten: a floor
 * at or above it is a candidate ahead of `latest`, and anything else —
 * `workspace:*`, `file:`, a compound range — is the app's own choice.
 */
export function rewrite(path: string, range: string, name: string = PACKAGE): boolean {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  const target = floorOf(range)!;

  let touched = false;
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = manifest[field];
    const floor = deps?.[name] === undefined ? undefined : floorOf(deps[name]);
    if (deps && floor && compareVersions(floor, target) < 0) {
      deps[name] = range;
      touched = true;
    }
  }
  if (!touched) return false;

  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  return true;
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
