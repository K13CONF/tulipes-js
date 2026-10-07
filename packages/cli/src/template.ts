import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { packageRoot } from "./package-info.js";
import type { InitFeatures, InitPreset } from "./init.js";

/**
 * `tulipes init` copies a template tree and transforms it; it renders no
 * file from strings. The production template IS the reference application
 * (`example/` in the framework repository): the published CLI carries a
 * copy under `templates/app`, packed at build time, and a source checkout
 * reads the example directly. The minimal preset is the committed tree
 * under `templates/minimal`.
 *
 * Every transformation is listed here, because the parity check in CI
 * diffs a generated app against the example and must find nothing else:
 *
 *   - the app name replaces the token `tulipes-example` wherever it occurs,
 *     and package.json `name` is set outright;
 *   - `workspace:` ranges on @tulipes packages become the versions this CLI
 *     was packed with, and `packageManager` the pnpm the framework pins;
 *   - the root manifest gets the pnpm settings a workspace root owns
 *     (overrides, the install-script allow-list), which the example cannot
 *     carry because it is itself a package inside the framework workspace;
 *   - a feature left out (`--no-queues`, `--no-sockets`) drops its files,
 *     its provider declaration, dependencies and scripts, and applies the
 *     overlay files under `templates/overlays/no-<feature>`;
 *   - README lines ending in `<!-- feature:x -->` belong to that feature.
 *
 * Generated outputs (`types/`, `.env.example`, the spec documents) are never
 * copied: the app regenerates them with `pnpm sync` and `pnpm spec`. The
 * agent guides are copied separately from `templates/`, so both presets
 * share one copy.
 */

export interface TemplateSource {
  /** Root of the tree to copy. */
  dir: string;
  /** Version of every @tulipes package, keyed by package name, plus `pnpm`. */
  versions: Record<string, string>;
}

/** The token every template spells the application name with. */
export const NAME_TOKEN = "tulipes-example";

const EXCLUDED_DIRS = new Set(["node_modules", "logs", "coverage", "types", ".claude", ".vitest", "dist"]);
const EXCLUDED_FILES = new Set([
  ".env.example",
  "docs/openapi.json",
  "docs/collection.json",
  "AGENTS.md",
  "CLAUDE.md",
  "pnpm-lock.yaml",
]);
const TEXT_EXTENSIONS = new Set([".ts", ".js", ".cjs", ".mjs", ".json", ".md", ".conf", ".yaml", ".yml", ".txt"]);
const TULIPES_PACKAGES = ["core", "cli", "spec", "mongoose", "bullmq", "socket.io"];

/**
 * A source checkout of the framework is recognised by its siblings. There
 * the live example and workspace versions always win over anything a
 * previous `pnpm pack` left under templates/, which would otherwise shadow
 * the files being edited.
 */
function repositoryRoot(): string | undefined {
  const root = resolve(packageRoot(), "..", "..");
  const inRepository = existsSync(join(root, "example", "package.json")) && existsSync(join(root, "packages", "core", "package.json"));
  return inRepository ? root : undefined;
}

/** Where the production template lives for this install. */
export function productionTemplate(): TemplateSource {
  const repository = repositoryRoot();
  if (repository) return { dir: join(repository, "example"), versions: readVersions() };

  const packed = join(packageRoot(), "templates", "app");
  if (!existsSync(join(packed, "package.json"))) {
    throw new Error("tulipes init: no production template — this CLI was packed without templates/app");
  }
  return { dir: packed, versions: readVersions() };
}

export function minimalTemplate(): TemplateSource {
  const dir = join(packageRoot(), "templates", "minimal");
  if (!existsSync(join(dir, "package.json"))) {
    throw new Error("tulipes init: no minimal template — this CLI was packed without templates/minimal");
  }
  return { dir, versions: readVersions() };
}

/**
 * Versions to scaffold against: written at pack time by
 * `scripts/pack-templates.mjs`, or read from the workspace in a checkout.
 */
export function readVersions(): Record<string, string> {
  const repository = repositoryRoot();
  if (!repository) {
    const packed = join(packageRoot(), "templates", "versions.json");
    if (!existsSync(packed)) throw new Error("tulipes init: no templates/versions.json — this CLI was packed without its templates");
    return JSON.parse(readFileSync(packed, "utf8")) as Record<string, string>;
  }

  const versions: Record<string, string> = {};
  const root = JSON.parse(readFileSync(join(repository, "package.json"), "utf8")) as { packageManager?: string };
  if (root.packageManager?.startsWith("pnpm@")) versions.pnpm = root.packageManager.slice("pnpm@".length);
  for (const name of TULIPES_PACKAGES) {
    const manifest = join(repository, "packages", name, "package.json");
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { name: string; version: string };
    versions[pkg.name] = pkg.version;
  }
  return versions;
}

/** Relative paths of every file the template contributes, before features apply. */
export function listTemplate(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const rel = relative(dir, path).split(sep).join("/");
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) walk(path);
        continue;
      }
      if (EXCLUDED_FILES.has(rel) || rel.endsWith(".missing.json")) continue;
      files.push(rel);
    }
  };
  walk(dir);
  return files.sort();
}

export interface RenderOptions {
  name: string;
  preset: InitPreset;
  features: InitFeatures;
}

/** The generated app as (relative path, contents) pairs. */
export function renderTemplate(source: TemplateSource, options: RenderOptions): [string, string | Buffer][] {
  const { name, features } = options;
  const overlays = join(packageRoot(), "templates", "overlays");
  const off = (["queues", "sockets"] as const).filter((feature) => !features[feature]);

  const output: [string, string | Buffer][] = [];
  for (const rel of listTemplate(source.dir)) {
    if (!features.queues && (rel === "worker.ts" || /(^|\/)queues\//.test(rel))) continue;
    if (!features.sockets && /(^|\/)sockets\//.test(rel)) continue;

    let file = join(source.dir, rel);
    for (const feature of off) {
      const overlay = join(overlays, `no-${feature}`, rel);
      if (existsSync(overlay)) file = overlay;
    }

    if (!TEXT_EXTENSIONS.has(extensionOf(rel)) && !rel.startsWith(".envs/")) {
      output.push([rel, readFileSync(file)]);
      continue;
    }

    let text = readFileSync(file, "utf8").replaceAll(NAME_TOKEN, name);
    if (rel === "package.json") text = rootManifest(text, name, source.versions, features);
    else if (/^modules\/[^/]+\/package\.json$/.test(rel)) text = moduleManifest(text, source.versions, features);
    else if (rel === "tsconfig.json" && !features.queues) text = withoutWorker(text);
    else if (rel === "README.md") text = featureLines(text, features);
    output.push([rel, text]);
  }

  // Files a generated app has and the template tree cannot carry.
  output.push(["pnpm-workspace.yaml", "packages:\n  - modules/*\n"]);
  output.push([".gitignore", options.preset === "minimal" ? MINIMAL_GITIGNORE : PRODUCTION_GITIGNORE]);
  return output;
}

function extensionOf(path: string): string {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index);
}

type Manifest = Record<string, unknown> & {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  tulipes?: { providers?: Record<string, string> } & Record<string, unknown>;
  pnpm?: { onlyBuiltDependencies?: string[] } & Record<string, unknown>;
};

const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";

function rootManifest(text: string, name: string, versions: Record<string, string>, features: InitFeatures): string {
  const pkg = JSON.parse(text) as Manifest;
  pkg.name = name;
  pinVersions(pkg, versions);
  if (!versions.pnpm) throw new Error("tulipes init: no packed pnpm version");
  pkg.packageManager = `pnpm@${versions.pnpm}`;
  // A template that is a workspace root itself (the minimal tree) carries
  // its own pnpm settings; the example is not one, so it gets the full set.
  pkg.pnpm ??= {
    // PM2's transitive dependencies, pinned past their advisories until PM2
    // ships the fixes itself: js-yaml (GHSA-c6x7-9hm3-xr4m) and basic-ftp
    // (GHSA-c475-qrg2-pj4r; get-uri uses it for ftp:// proxies only).
    overrides: { "pm2>js-yaml": "4.3.2", "basic-ftp": "^6.2.1" },
    // braces (GHSA-vfj7-8cjw-p6xm, via pm2's chokidar) has no fixed release:
    // it expands the watch globs an operator writes, never request input.
    auditConfig: { ignoreGhsas: ["GHSA-vfj7-8cjw-p6xm"] },
    // The only install scripts pnpm may run: tsx's esbuild binary and, with
    // queues, bullmq's optional native helper. Everything else is blocked.
    onlyBuiltDependencies: ["esbuild", "msgpackr-extract"],
  };
  if (!features.queues) {
    delete pkg.tulipes?.providers?.queues;
    delete pkg.dependencies?.["@tulipes/bullmq"];
    delete pkg.scripts?.worker;
    if (pkg.pnpm.onlyBuiltDependencies) {
      pkg.pnpm.onlyBuiltDependencies = pkg.pnpm.onlyBuiltDependencies.filter((dep) => dep !== "msgpackr-extract");
    }
  }
  if (!features.sockets) {
    delete pkg.tulipes?.providers?.sockets;
    delete pkg.dependencies?.["@tulipes/socket.io"];
  }
  return json(pkg);
}

function moduleManifest(text: string, versions: Record<string, string>, features: InitFeatures): string {
  const pkg = JSON.parse(text) as Manifest;
  pinVersions(pkg, versions);
  if (!features.queues) delete pkg.dependencies?.["@tulipes/bullmq"];
  if (!features.sockets) delete pkg.dependencies?.["@tulipes/socket.io"];
  return json(pkg);
}

/**
 * `workspace:*` and `workspace:^` on a @tulipes package become `^<version>`.
 * A module's `@app/*` dependency stays a workspace link: the generated app
 * is a pnpm workspace of its modules exactly as the example is.
 */
function pinVersions(pkg: Manifest, versions: Record<string, string>): void {
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [dep, range] of Object.entries(deps)) {
      if (!range.startsWith("workspace:") || !dep.startsWith("@tulipes/")) continue;
      const version = versions[dep];
      if (!version) throw new Error(`tulipes init: no packed version for ${dep} (${range})`);
      deps[dep] = `^${version}`;
    }
  }
}

function withoutWorker(text: string): string {
  const config = JSON.parse(text) as { include?: string[] };
  if (config.include) config.include = config.include.filter((path) => path !== "worker.ts");
  return json(config);
}

/** Lines tagged `<!-- feature:x -->` stay (untagged) only when x is on. */
function featureLines(text: string, features: InitFeatures): string {
  return text
    .split("\n")
    .filter((line) => {
      const tag = /<!-- feature:(\w+) -->\s*$/.exec(line);
      return !tag || features[tag[1] as keyof InitFeatures] !== false;
    })
    .map((line) => line.replace(/\s*<!-- feature:\w+ -->\s*$/, ""))
    .join("\n");
}

const PRODUCTION_GITIGNORE = [
  "node_modules/",
  "dist/",
  "logs/",
  "*.log",
  "",
  "# Environment files are local. `.env.example` — generated by",
  "# `pnpm sync`, and committed — is the contract: it names every",
  "# variable any module declares. Copy from it, never the reverse.",
  ".envs/",
  ".env",
  ".env.local",
  "",
  "# written outside production for whoever writes the translations:",
  "# every key a locale is still missing, with the default-locale text",
  "**/modules/*/i18n/*.missing.json",
  "",
].join("\n");

const MINIMAL_GITIGNORE = "node_modules/\n.envs/\ncoverage/\nlogs/\n";

/** @internal For the pack script: does a directory of this name belong to the template? */
export function isTemplateDir(name: string): boolean {
  return !EXCLUDED_DIRS.has(name);
}

/** @internal For the pack script: is this file part of the template at all? */
export function isTemplateFile(rel: string): boolean {
  const parts = rel.split("/");
  if (parts.slice(0, -1).some((dir) => EXCLUDED_DIRS.has(dir))) return false;
  return !EXCLUDED_FILES.has(rel) && !rel.endsWith(".missing.json");
}
