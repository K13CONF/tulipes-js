import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { appCoreVersion, cliVersion, packageRoot } from "./package-info.js";

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
    if (current === latestCli) {
      console.log(`cli already on ${latestCli}`);
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
  // The app's own CLI devDependency moves with it, so `yarn dev` and friends
  // keep matching the framework they generate for.
  if (rewrite(join(rootDir, "package.json"), `^${latestCli}`, CLI)) changed.push({ path: join(rootDir, "package.json") });

  if (changed.length === 0) {
    console.log(`app already on ${PACKAGE}@${range}`);
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

/** Returns true when the file actually changed. */
function rewrite(path: string, range: string, name: string = PACKAGE): boolean {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;

  let touched = false;
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = manifest[field];
    if (deps?.[name] !== undefined && deps[name] !== range) {
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
