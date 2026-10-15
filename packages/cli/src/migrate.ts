import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

/**
 * `tulipes migrate 0.11` — the mechanical half of MIGRATING.md for an app
 * generated on 0.10: file moves, import specifiers, the routes unwrapping,
 * a `defineConfig` declaration written from what the old factory read,
 * the lifecycle bodies moved into a bootstrap file, and the package
 * manager, scripts and compiler flags. Every judgement it cannot make is a
 * `TODO 0.11:` comment in the file and a line in the report; nothing is
 * deleted that the migrated app could still need. Idempotent: a second run
 * finds nothing to do.
 *
 * What it writes besides code: `config/migration-0.11.json`, the record of
 * which variables became which settings, which `tulipes config:import`
 * reads to carry a deployment's values into the store.
 */
export interface MigrationReport {
  changed: string[];
  todos: string[];
  mappings: Record<string, Record<string, { variable: string; type: string }>>;
}

const PNPM = "pnpm@10.28.0";

export async function runMigrate(rootDir: string, target: string, options: { scope?: string } = {}): Promise<void> {
  if (target !== "0.11") {
    console.error(`unknown migration target "${target}" — this CLI migrates an app to 0.11 (from 0.10), 0.12 (from 0.11) or 0.13 (from 0.12)`);
    process.exitCode = 2;
    return;
  }
  if (options.scope !== undefined) {
    console.error("--scope applies to tulipes migrate 0.12 only");
    process.exitCode = 2;
    return;
  }
  const report = migrate(rootDir);
  for (const line of report.changed) console.log(`  ${line}`);
  console.log(`\nmigrated ${report.changed.length} thing(s); ${report.todos.length} TODO(s) to review`);
  for (const todo of report.todos) console.log(`  ! ${todo}`);
  console.log(
    [
      "",
      "next:",
      "  pnpm install                # the app is a pnpm workspace now",
      "  pnpm sync                   # regenerate types/tulipes.d.ts",
      "  pnpm typecheck              # the TODOs above are where it may fail",
      "  tulipes config:import       # carry .envs values that became settings into the store",
      `  review config/migration-0.11.json, then delete it`,
    ].join("\n"),
  );
}

export function migrate(rootDir: string): MigrationReport {
  const report: MigrationReport = { changed: [], todos: [], mappings: {} };
  const note = (line: string) => report.changed.push(line);

  // ── root ────────────────────────────────────────────────────────────────
  migrateRootManifest(rootDir, report);
  migrateTsconfig(rootDir, report);
  migrateVitestConfig(rootDir, report);
  migrateEcosystem(rootDir, report);
  for (const stale of ["types/config.d.ts"]) {
    const file = join(rootDir, stale);
    if (existsSync(file) && readFileSync(file, "utf8").startsWith("// AUTO-GENERATED")) {
      rmSync(file);
      note(`removed ${stale} (tulipes sync writes types/tulipes.d.ts)`);
    }
  }

  // ── modules ─────────────────────────────────────────────────────────────
  const modulesDir = join(rootDir, "modules");
  const modules = existsSync(modulesDir)
    ? readdirSync(modulesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name)
    : [];
  for (const name of modules) migrateModule(rootDir, join(modulesDir, name), name, report);

  // ── root files importing what only a module declares (pnpm isolation) ──
  hoistRootImports(rootDir, modules, report);

  // ── every TypeScript file: specifiers, parameter properties, inspection ──
  for (const file of walkTs(rootDir)) {
    const source = readFileSync(file, "utf8");
    let next = rewriteSpecifiers(source);
    next = rewriteParameterProperties(next, relative(rootDir, file), report);
    next = rewriteInspection(next);
    if (next !== source) {
      writeFileSync(file, next);
      note(`rewrote ${relative(rootDir, file)}`);
    }
  }

  const record = join(rootDir, "config", "migration-0.11.json");
  mkdirSync(dirname(record), { recursive: true });
  writeFileSync(record, JSON.stringify({ migrated_at: new Date().toISOString(), settings: report.mappings, todos: report.todos }, null, 2) + "\n");
  note(`wrote config/migration-0.11.json (${Object.keys(report.mappings).length} module(s) with settings imported from variables)`);
  return report;
}

// ── root files ────────────────────────────────────────────────────────────

const BUILTINS = new Set(["assert", "buffer", "child_process", "crypto", "events", "fs", "http", "https", "net", "os", "path", "process", "stream", "timers", "tls", "url", "util", "zlib"]);

/**
 * yarn hoisted every module's dependencies to the root, so a test or script
 * could import `jsonwebtoken` because the auth module declared it. pnpm
 * installs each package with only its own dependencies: what the root's
 * files import, the root declares — taking the range a module already uses.
 */
function hoistRootImports(rootDir: string, modules: string[], report: MigrationReport): void {
  const file = join(rootDir, "package.json");
  if (!existsSync(file)) return;
  const pkg = readJson(file) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  const moduleRanges = new Map<string, string>();
  for (const name of modules) {
    const manifest = join(rootDir, "modules", name, "package.json");
    if (!existsSync(manifest)) continue;
    const moduleManifest = readJson(manifest) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    for (const [dep, range] of Object.entries({ ...moduleManifest.devDependencies, ...moduleManifest.dependencies })) {
      if (!moduleRanges.has(dep) && !dep.startsWith("@app/")) moduleRanges.set(dep, range);
    }
  }
  const rootFiles = walkTs(rootDir).filter((path) => !relative(rootDir, path).startsWith("modules" + "/"));
  const added: string[] = [];
  for (const path of rootFiles) {
    for (const match of readFileSync(path, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"'./][^"']*)["']/g)) {
      const specifier = match[1]!;
      const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
      if (name.startsWith("node:") || BUILTINS.has(name) || declared.has(name) || name.startsWith("@app/")) continue;
      const range = moduleRanges.get(name);
      if (!range) continue;
      (pkg.devDependencies ??= {})[name] = range;
      declared.add(name);
      added.push(name);
      const types = `@types/${name.replace(/^@/, "").replace("/", "__")}`;
      if (!declared.has(types) && moduleRanges.has(types)) {
        pkg.devDependencies[types] = moduleRanges.get(types)!;
        declared.add(types);
        added.push(types);
      }
    }
  }
  if (added.length > 0) {
    writeJson(file, pkg);
    report.changed.push(`package.json: devDependencies ${added.join(", ")} (imported by root files; pnpm does not hoist a module's dependencies)`);
  }
}

function migrateRootManifest(rootDir: string, report: MigrationReport): void {
  const file = join(rootDir, "package.json");
  if (!existsSync(file)) return;
  const pkg = readJson(file) as Record<string, unknown> & {
    packageManager?: string; workspaces?: string[]; resolutions?: Record<string, string>;
    pnpm?: Record<string, unknown>; scripts?: Record<string, string>; devDependencies?: Record<string, string>;
    tulipes?: { providers?: Record<string, string> };
  };
  let changed = false;
  if (!pkg.packageManager?.startsWith("pnpm@")) {
    pkg.packageManager = PNPM;
    changed = true;
  }
  if (pkg.workspaces) {
    writeFileSync(join(rootDir, "pnpm-workspace.yaml"), "packages:\n" + pkg.workspaces.map((glob) => `  - ${JSON.stringify(glob)}\n`).join(""));
    delete pkg.workspaces;
    changed = true;
  }
  const pnpm = (pkg.pnpm ??= {}) as { overrides?: Record<string, string>; onlyBuiltDependencies?: string[]; auditConfig?: { ignoreGhsas?: string[] } };
  if (pkg.resolutions) {
    pnpm.overrides = { ...pnpm.overrides, ...Object.fromEntries(Object.entries(pkg.resolutions).map(([key, value]) => [key.replace("pm2/js-yaml", "pm2>js-yaml"), value])) };
    delete pkg.resolutions;
    changed = true;
  }
  const built = new Set(pnpm.onlyBuiltDependencies ?? []);
  built.delete("esbuild");
  if (pkg.tulipes?.providers?.queues) built.add("msgpackr-extract");
  const nextBuilt = [...built];
  if (JSON.stringify(nextBuilt) !== JSON.stringify(pnpm.onlyBuiltDependencies ?? [])) {
    pnpm.onlyBuiltDependencies = nextBuilt;
    changed = true;
  }
  if (pkg.scripts) {
    const scripts = pkg.scripts;
    const wanted: Record<string, string | undefined> = {
      start: scripts.start === "tsx app.ts" ? "node app.ts" : undefined,
      worker: scripts.worker === "tsx worker.ts" ? "node worker.ts" : undefined,
      script: scripts.script === "tsx" ? "node" : undefined,
      spec: scripts.spec?.includes("--offline") ? scripts.spec.replace(/\s--offline\b/, "") : undefined,
    };
    for (const [name, value] of Object.entries(wanted)) {
      if (value !== undefined) { scripts[name] = value; changed = true; }
    }
  }
  if (pkg.devDependencies?.tsx) {
    delete pkg.devDependencies.tsx;
    changed = true;
  }
  if (changed) {
    writeJson(file, pkg);
    report.changed.push("package.json: pnpm workspace, node scripts, no tsx");
  }
  for (const yarn of [".yarnrc.yml", "yarn.lock"]) {
    if (existsSync(join(rootDir, yarn))) {
      rmSync(join(rootDir, yarn));
      report.changed.push(`removed ${yarn}`);
    }
  }
}

function migrateTsconfig(rootDir: string, report: MigrationReport): void {
  const file = join(rootDir, "tsconfig.json");
  if (!existsSync(file)) return;
  const config = readJson(file) as { compilerOptions?: Record<string, unknown> };
  const options = (config.compilerOptions ??= {});
  const flags = { allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, erasableSyntaxOnly: true };
  if (Object.entries(flags).every(([key, value]) => options[key] === value)) return;
  Object.assign(options, flags);
  writeJson(file, config);
  report.changed.push("tsconfig.json: allowImportingTsExtensions, rewriteRelativeImportExtensions, erasableSyntaxOnly");
}

function migrateVitestConfig(rootDir: string, report: MigrationReport): void {
  const file = join(rootDir, "vitest.config.ts");
  if (!existsSync(file)) return;
  const source = readFileSync(file, "utf8");
  const next = source.replace(/,?\s*execArgv:\s*\[\s*"--import",\s*"tsx"\s*\]/, "");
  if (next !== source) {
    writeFileSync(file, next);
    report.changed.push("vitest.config.ts: no tsx loader");
  }
}

function migrateEcosystem(rootDir: string, report: MigrationReport): void {
  const file = join(rootDir, "ecosystem.config.cjs");
  if (!existsSync(file)) return;
  const source = readFileSync(file, "utf8");
  const next = source.replace(/interpreter:\s*["']\.\/node_modules\/\.bin\/tsx["']/, 'interpreter: "node"');
  if (next !== source) {
    writeFileSync(file, next);
    report.changed.push("ecosystem.config.cjs: PM2 runs node directly");
  }
}

// ── modules ───────────────────────────────────────────────────────────────

interface VariableSpec { name: string; type: string; default?: unknown; enum?: string[]; description?: string; required?: boolean }

function migrateModule(rootDir: string, dir: string, name: string, report: MigrationReport): void {
  const label = `modules/${name}`;
  const manifestFile = join(dir, "package.json");
  if (!existsSync(manifestFile)) return;
  const manifest = readJson(manifestFile) as Record<string, unknown> & { tulipes?: Record<string, unknown> & { env?: VariableSpec[]; offline?: unknown }; exports?: unknown };
  let manifestChanged = false;

  // meta.variables.json → package.json tulipes.env
  const meta = join(dir, "meta.variables.json");
  if (existsSync(meta)) {
    const parsed = readJson(meta) as { variables?: VariableSpec[] };
    manifest.tulipes = { ...manifest.tulipes, env: [...(manifest.tulipes?.env ?? []), ...(parsed.variables ?? [])] };
    rmSync(meta);
    manifestChanged = true;
    report.changed.push(`${label}: meta.variables.json → package.json tulipes.env`);
  }
  if (manifest.tulipes && "offline" in manifest.tulipes) {
    delete manifest.tulipes.offline;
    manifestChanged = true;
    report.changed.push(`${label}: tulipes.offline removed (every routes file is inspected)`);
  }

  // index.ts → lib/index.ts
  if (existsSync(join(dir, "index.ts"))) {
    mkdirSync(join(dir, "lib"), { recursive: true });
    const source = readFileSync(join(dir, "index.ts"), "utf8");
    writeFileSync(join(dir, "lib", "index.ts"), deepenRelativeImports(source));
    rmSync(join(dir, "index.ts"));
    manifest.exports = { ".": "./lib/index.ts" };
    manifestChanged = true;
    report.changed.push(`${label}: index.ts → lib/index.ts (package.json exports)`);
  }

  // schemas.ts → schemas/<name>.schemas.ts
  if (existsSync(join(dir, "schemas.ts"))) {
    mkdirSync(join(dir, "schemas"), { recursive: true });
    const source = readFileSync(join(dir, "schemas.ts"), "utf8");
    writeFileSync(join(dir, "schemas", `${name}.schemas.ts`), deepenRelativeImports(source));
    rmSync(join(dir, "schemas.ts"));
    for (const file of walkTs(dir)) {
      const text = readFileSync(file, "utf8");
      const next = text.replace(/(["'])(\.\.?\/)schemas\.(?:js|ts)\1/g, (_match, quote: string, prefix: string) => `${quote}${prefix}schemas/${name}.schemas.ts${quote}`);
      if (next !== text) writeFileSync(file, next);
    }
    report.changed.push(`${label}: schemas.ts → schemas/${name}.schemas.ts`);
  }

  // module.config.ts: factory + lifecycle → defineConfig + bootstrap
  const configFile = join(dir, "module.config.ts");
  if (existsSync(configFile)) migrateModuleConfig(rootDir, dir, name, configFile, manifest, report);

  // routes: defineRoutes/runtime → plain functions; `agent: false` gone
  const routesDir = join(dir, "routes");
  if (existsSync(routesDir)) {
    for (const path of walkTs(routesDir)) {
      const file = relative(routesDir, path);
      migrateRoutesFile(path, dir, name, report);
      stripAgentOptOut(path, `${label}/routes/${file}`, report);
    }
  }

  // agent: tools with route references → actions only (0.11.0-rc.3)
  const agentDir = join(dir, "agent");
  if (existsSync(agentDir)) {
    for (const file of readdirSync(agentDir).filter((entry) => entry.endsWith(".agent.ts"))) {
      migrateAgentFile(join(agentDir, file), `${label}/agent/${file}`, report);
    }
  }

  // anything else at the root is refused by the boot
  for (const entry of readdirSync(dir)) {
    if (["package.json", "module.config.ts", "module.acl.ts", "node_modules"].includes(entry)) continue;
    if (statSync(join(dir, entry)).isFile()) {
      report.todos.push(`${label}/${entry}: a module's root holds package.json, module.config.ts and module.acl.ts — move it into a folder (helpers/, lib/, …)`);
    }
  }

  if (manifestChanged) writeJson(manifestFile, manifest);
}

/** `./helpers/x.ts` → `../helpers/x.ts`: the file moved one folder down. */
function deepenRelativeImports(source: string): string {
  return rewriteSpecifiers(source).replace(/((?:from|import)\s*\(?\s*['"])(\.\.?\/)/g, (_match, head: string, prefix: string) => `${head}${prefix === "./" ? "../" : "../../"}`);
}

const CTX_NAMES = ["Environment", "config", "settings", "mode", "modules", "signal", "acl", "models", "queues", "sockets", "app", "routes", "rai", "t", "i18n", "agent"];

function migrateModuleConfig(rootDir: string, dir: string, name: string, file: string, manifest: { tulipes?: { env?: VariableSpec[] } }, report: MigrationReport): void {
  const source = readFileSync(file, "utf8");
  if (source.includes("defineConfig(")) return;
  const label = `modules/${name}/module.config.ts`;

  const factory = /export default (?:async )?function\s*\w*\s*\(([^)]*)\)[^{]*\{\n([\s\S]*?)\n\}/.exec(source);
  const hooks: Record<string, { params: string; body: string }> = {};
  for (const hook of ["onReady", "onDrain", "onShutdown"]) {
    const match = new RegExp(`export (?:async )?function ${hook}\\s*\\(([^)]*)\\)[^{]*\\{\\n([\\s\\S]*?)\\n\\}`).exec(source);
    if (match) hooks[hook] = { params: match[1]!, body: match[2]! };
  }
  if (!factory && Object.keys(hooks).length === 0) {
    report.todos.push(`${label}: no factory or lifecycle export recognised — rewrite it as defineConfig({ schema }) by hand`);
    return;
  }

  // What the factory returned, field by field.
  const fields: string[] = [];
  const prelude: string[] = [];
  const variables = manifest.tulipes?.env ?? [];
  const consumed = new Set<string>();
  if (factory) {
    const body = factory[2]!;
    const returned = /return\s*\{([\s\S]*)\}\s*;?\s*$/.exec(body);
    const before = returned ? body.slice(0, returned.index) : body;
    for (const line of before.split("\n")) {
      if (line.trim() && !line.trim().startsWith("//")) prelude.push(line);
    }
    const object = returned?.[1] ?? "";
    for (const entry of splitEntries(object)) {
      const spread = /^\.\.\.config\.(\w+)$/.exec(entry);
      const pair = /^(\w+)\s*:\s*([\s\S]+)$/.exec(entry);
      if (spread) {
        const seed = seedFields(rootDir, spread[1]!);
        if (seed) fields.push(...seed);
        else report.todos.push(`${label}: the factory returned { ...config.${spread[1]} }; declare those fields in the schema with defaults`);
        continue;
      }
      if (!pair) {
        report.todos.push(`${label}: could not read "${entry.trim().slice(0, 60)}" — declare it in the schema by hand`);
        continue;
      }
      const [, key, raw] = pair;
      const expression = raw!.trim();
      const read = /^Environment\.get\(["'](\w+)["']\)$/.exec(expression);
      if (read) {
        const variable = variables.find((spec) => spec.name === read[1]);
        if (variable) {
          fields.push(`    ${key}: ${zodOf(variable)},`);
          consumed.add(variable.name);
          (report.mappings[name] ??= {})[key!] = { variable: variable.name, type: variable.type };
        } else {
          fields.push(`    ${key}: z.string().default(""), // TODO 0.11: was Environment.get("${read[1]}"), which this module does not declare`);
          report.todos.push(`${label}: ${key} read ${read[1]}, a variable this module does not declare`);
        }
        continue;
      }
      const literal = zodOfLiteral(expression);
      if (literal) {
        fields.push(`    ${key}: ${literal},`);
      } else {
        fields.push(`    ${key}: z.unknown().default(null), // TODO 0.11: was computed: ${expression.replace(/\s+/g, " ").slice(0, 80)}`);
        report.todos.push(`${label}: ${key} was computed at boot (${expression.replace(/\s+/g, " ").slice(0, 60)}); give it a schema and a default`);
      }
    }
  }

  // Variables that only the factory read are settings now.
  for (const variable of consumed) {
    const elsewhere = walkTs(rootDir).some((other) => other !== file && readFileSync(other, "utf8").includes(`"${variable}"`));
    if (elsewhere) {
      report.todos.push(`${label}: ${variable} became a setting but is still read elsewhere — it stays declared in package.json tulipes.env until those reads move to ctx.config.${name}`);
      continue;
    }
    if (manifest.tulipes?.env) manifest.tulipes.env = manifest.tulipes.env.filter((spec) => spec.name !== variable);
  }
  if (manifest.tulipes?.env && manifest.tulipes.env.length === 0) delete manifest.tulipes.env;

  // Imports: what the schema needs stays; everything the old file imported
  // also travels to the bootstrap file, one folder deeper.
  const imports = source.split("\n").filter((line) => /^import\s/.test(line) || /^import\s*\{/.test(line));
  const keptImports = imports
    .filter((line) => !/from "@tulipes\/core\/boot"/.test(line) || /\b(RuntimeCtx|BootstrapCleanup)\b/.test(line))
    .map((line) => line.replace(/\bConfigCtx,?\s*/g, "").replace(/\{\s*,/, "{").replace(/,\s*\}/, " }"));
  const topLevel = source.split("\n").filter((line) =>
    !/^import\s/.test(line) && !/^export\s/.test(line) && !/^\s/.test(line) && !/^\}/.test(line) && !/^\/\//.test(line) && !/^\/?\*/.test(line) && line.trim() && !line.startsWith("}"),
  );

  const declaration = [
    `import { defineConfig } from "@tulipes/core/config";`,
    `import { z } from "zod/v4";`,
    ...keptImports.filter((line) => !/^import type \{\s*\}/.test(line) && !/from "zod/.test(line)),
    "",
    ...(topLevel.length ? [...topLevel, ""] : []),
    "/**",
    " * Written by `tulipes migrate 0.11` from the 0.10 config factory: every",
    " * field it returned is a setting with a default, stored per deployment",
    " * and edited through the console. Values that came from the environment",
    " * are carried over by `tulipes config:import`.",
    " */",
    "export default defineConfig({",
    "  schema: z.object({",
    ...fields,
    "  }),",
    "});",
    "",
  ].join("\n");
  writeFileSync(file, declaration);
  report.changed.push(`${label}: factory → defineConfig (${fields.length} field(s))`);

  // Lifecycle bodies → a bootstrap file.
  if (Object.keys(hooks).length > 0 || prelude.length > 0) {
    const names = new Set<string>();
    const aliases: string[] = [];
    const collect = (params: string) => {
      const destructured = /\{([^}]*)\}/.exec(params);
      if (destructured) {
        for (const part of destructured[1]!.split(",")) {
          const key = part.trim().split(":")[0]!.trim();
          if (key && CTX_NAMES.includes(key)) names.add(key);
        }
      } else {
        const identifier = params.trim().split(":")[0]!.trim();
        if (identifier && identifier !== "ctx" && !identifier.startsWith("_")) aliases.push(`const ${identifier} = ctx;`);
      }
    };
    if (factory) collect(factory[1]!);
    for (const hook of Object.values(hooks)) collect(hook.params);
    const indent = (lines: string[]) => lines.map((line) => (line.trim() ? `  ${line}` : line));
    const bootstrapDir = join(dir, "bootstrap");
    mkdirSync(bootstrapDir, { recursive: true });
    const target = join(bootstrapDir, `${name}.lifecycle.bootstrap.ts`);
    const lines = [
      `import type { BootstrapCleanup, RuntimeCtx } from "@tulipes/core/boot";`,
      ...imports.filter((line) => !/from "@tulipes\/core\/boot"/.test(line)).map((line) => deepenRelativeImports(line.replace(/\bConfigCtx,?\s*/g, "").replace(/\{\s*,/, "{").replace(/,\s*\}/, " }"))).filter((line) => !/^import type \{\s*\}/.test(line)),
      "",
      "/**",
      " * Written by `tulipes migrate 0.11` from module.config.ts's lifecycle",
      " * exports. Bootstrap runs in EVERY mode, backend, worker and script,",
      " * after settings, translations and ACL and before routes or queues;",
      " * onReady used to run after the server listened, onShutdown in reverse",
      " * load order after traffic drained — which is when the returned",
      " * cleanup runs now. TODO 0.11: review each block, and guard work a",
      " * one-off script should skip with `if (ctx.mode === \"script\") return;`.",
      " */",
      `export default async function ${camel(name)}Lifecycle(ctx: RuntimeCtx): Promise<BootstrapCleanup | void> {`,
      ...(names.size ? [`  const { ${[...names].join(", ")} } = ctx;`] : []),
      ...aliases.map((alias) => `  ${alias}`),
      ...(prelude.length ? ["  // TODO 0.11: this ran in the config factory (boot phase 6, before models); it runs at bootstrap now.", ...prelude, ""] : []),
      ...(hooks.onReady ? ["  // from onReady:", ...hooks.onReady.body.split("\n"), ""] : []),
      ...(hooks.onDrain ? ["  // from onDrain — ctx.signal aborts the moment shutdown begins:", "  ctx.signal.addEventListener(\"abort\", () => {", ...indent(hooks.onDrain.body.split("\n")), "  }, { once: true });", ""] : []),
      ...(hooks.onShutdown ? ["  // from onShutdown — runs after traffic drains, in reverse load order:", "  return async () => {", ...indent(hooks.onShutdown.body.split("\n")), "  };"] : []),
      "}",
      "",
    ];
    writeFileSync(target, lines.join("\n"));
    report.changed.push(`modules/${name}: lifecycle exports → bootstrap/${name}.lifecycle.bootstrap.ts`);
    report.todos.push(`modules/${name}/bootstrap/${name}.lifecycle.bootstrap.ts: review the moved ${[...(prelude.length ? ["factory statements"] : []), ...Object.keys(hooks)].join(", ")} and the mode guard`);
  }
}

/** The `NS: { … }` literal of config/app.config.ts, as schema fields. */
function seedFields(rootDir: string, namespace: string): string[] | undefined {
  const file = join(rootDir, "config", "app.config.ts");
  if (!existsSync(file)) return undefined;
  const source = readFileSync(file, "utf8");
  const block = new RegExp(`\\n\\s*${namespace}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`).exec(source);
  if (!block) return undefined;
  const fields: string[] = [];
  for (const entry of splitEntries(block[1]!)) {
    const pair = /^(\w+)\s*:\s*([\s\S]+)$/.exec(entry);
    const literal = pair && zodOfLiteral(pair[2]!.trim());
    if (pair && literal) fields.push(`    ${pair[1]}: ${literal},`);
    else return undefined;
  }
  return fields;
}

/** Top-level `key: value` entries of an object literal body, comments dropped. */
function splitEntries(body: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let current = "";
  let inString: string | undefined;
  let inComment: "line" | "block" | undefined;
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    const pair = body.slice(i, i + 2);
    if (inComment === "line") { if (char === "\n") inComment = undefined; continue; }
    if (inComment === "block") { if (pair === "*/") { inComment = undefined; i++; } continue; }
    if (inString) {
      current += char;
      if (char === "\\") { current += body[i + 1] ?? ""; i++; continue; }
      if (char === inString) inString = undefined;
      continue;
    }
    if (pair === "//") { inComment = "line"; continue; }
    if (pair === "/*") { inComment = "block"; i++; continue; }
    if (char === '"' || char === "'" || char === "`") { inString = char; current += char; continue; }
    if ("([{".includes(char)) depth++;
    if (")]}".includes(char)) depth--;
    if (char === "," && depth === 0) { entries.push(current.trim()); current = ""; continue; }
    current += char;
  }
  if (current.trim()) entries.push(current.trim());
  return entries.filter(Boolean);
}

function zodOf(spec: VariableSpec): string {
  const describe = spec.description ? `.describe(${JSON.stringify(spec.description)})` : "";
  const fallback = spec.type === "number" ? 0 : spec.type === "boolean" ? false : spec.type === "enum" ? spec.enum?.[0] ?? "" : "";
  const value = spec.default ?? fallback;
  const base = spec.type === "number" ? "z.number()" : spec.type === "boolean" ? "z.boolean()" : spec.type === "enum" ? `z.enum(${JSON.stringify(spec.enum ?? [])})` : "z.string()";
  const todo = spec.default === undefined ? ` // TODO 0.11: ${spec.name} had no default; this one was invented` : "";
  return `${base}.default(${JSON.stringify(value)})${describe}${todo}`;
}

function zodOfLiteral(expression: string): string | undefined {
  if (/^-?\d+(\.\d+)?$/.test(expression)) return `z.number().default(${expression})`;
  if (/^(true|false)$/.test(expression)) return `z.boolean().default(${expression})`;
  if (/^(["'])(?:(?!\1).)*\1$/.test(expression)) return `z.string().default(${JSON.stringify(expression.slice(1, -1))})`;
  if (/^\[(\s*(["'])(?:(?!\2).)*\2\s*,?\s*)*\]$/.test(expression)) {
    const items = expression.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean).map((item) => item.slice(1, -1));
    return `z.array(z.string()).default(${JSON.stringify(items)})`;
  }
  return undefined;
}

// ── routes ────────────────────────────────────────────────────────────────

function migrateRoutesFile(file: string, moduleDir: string, name: string, report: MigrationReport): void {
  const source = readFileSync(file, "utf8");
  if (!source.includes("defineRoutes(")) return;
  const label = relative(dirname(moduleDir), file);
  let next = source;

  // The wrapper: `export default defineRoutes(({ app, rai, routes, runtime }) => {` … `});`
  const head = /export default defineRoutes\(\s*(?:async\s*)?\(\s*(\{[^}]*\}|\w+)\s*\)\s*=>\s*\{\n/.exec(next);
  if (!head) {
    report.todos.push(`${label}: defineRoutes() in a shape this migration does not rewrite — make it a plain (ctx: BackendCtx) => Router | void function`);
    return;
  }
  const params = head[1]!;
  const names = params.startsWith("{") ? params.slice(1, -1).split(",").map((part) => part.trim()).filter(Boolean) : [];
  const usesRuntime = names.includes("runtime") || params === "runtime";
  const bound = names.filter((part) => part !== "runtime");
  const fn = `${camel(basename(file).replace(/\.routes\.ts$/, ""))}Routes`;
  const tail = /\n\}\);\s*$/.exec(next);
  if (!tail) {
    report.todos.push(`${label}: could not find the end of defineRoutes() — rewrite by hand`);
    return;
  }
  next = next.slice(0, head.index) + `export default function ${fn}(ctx: BackendCtx): void {\n` + (bound.length ? `  const { ${bound.join(", ")} } = ctx;\n` : "") + next.slice(head.index + head[0].length, tail.index) + "\n}\n";

  // Controllers: a runtime() that only instantiates one becomes a static import.
  const controller = /const (\w+) = runtime\(async\s*\(?(\w+)\)?\s*=>\s*\{\s*const \{ (\w+) \} = await import\(["']([^"']+)["']\);\s*return new \3\(\2\);\s*\}\);/g;
  const statics: string[] = [];
  next = next.replace(controller, (_match, variable: string, _ctx: string, Controller: string, path: string) => {
    statics.push(`import { ${Controller} } from "${path.replace(/\.js$/, ".ts")}";`);
    return `const ${variable} = new ${Controller}(ctx);`;
  });
  for (const line of statics) {
    const variable = /import \{ (\w+) \}/.exec(line)![1]!;
    const instances = [...next.matchAll(new RegExp(`const (\\w+) = new ${variable}\\(ctx\\);`, "g"))].map((match) => match[1]!);
    for (const instance of instances) {
      next = next.replace(new RegExp(`\\b${instance}\\(\\s*\\w+\\s*=>\\s*\\w+\\.(\\w+)(\\([^)]*\\))?\\s*\\)`, "g"), (_match, member: string, call: string | undefined) => `${instance}.${member}${call ?? ""}`);
    }
  }

  // Whatever runtime() remains keeps its semantics through a local helper.
  let helperNeeded = false;
  if (usesRuntime && /\bruntime\(/.test(next)) {
    helperNeeded = true;
    next = next.replace(/\bruntime\(\s*async/g, "runtime(ctx, async");
    report.todos.push(`${label}: runtime() kept through helpers/runtime.ts — build from ctx.config and the environment directly where you can (see the reference app's lazy())`);
  }

  // Mounting: routes.mount(app, path, router) → routes.mount(router, path).
  next = next.replace(/routes\.mount\(\s*app\s*,\s*([^,]+?)\s*,\s*(\w+)\s*\)/g, "routes.mount($2, $1)");

  // Imports: no wrapper, the backend context, the controllers, the helper.
  next = next.replace(/import \{ defineRoutes \} from "@tulipes\/core\/http";\n/, "").replace(/import \{ defineRoutes, /, "import { ").replace(/, defineRoutes \}/, " }");
  const added = [`import type { BackendCtx } from "@tulipes/core/boot";`, ...statics, ...(helperNeeded ? [`import { runtime } from "../helpers/runtime.ts";`] : [])];
  const at = importHeaderEnd(next);
  next = next.slice(0, at) + added.join("\n") + "\n" + next.slice(at);

  if (helperNeeded) {
    const helpersDir = join(moduleDir, "helpers");
    mkdirSync(helpersDir, { recursive: true });
    const helper = join(helpersDir, "runtime.ts");
    if (!existsSync(helper)) writeFileSync(helper, RUNTIME_HELPER);
  }
  writeFileSync(file, next);
  report.changed.push(`${label}: defineRoutes/runtime → plain routes function${statics.length ? ` (${statics.length} controller(s) imported statically)` : ""}`);
  void name;
}

/** Routes are not tools since 0.11.0-rc.3, so the opt-out on a RAI means nothing. */
function stripAgentOptOut(file: string, label: string, report: MigrationReport): void {
  const source = readFileSync(file, "utf8");
  const next = source
    .replace(/^\s*agent:\s*false,?\s*\n/gm, "")
    .replace(/,\s*agent:\s*false(?=\s*[,}])/g, "")
    .replace(/\{\s*agent:\s*false,\s*/g, "{ ");
  if (next === source) return;
  writeFileSync(file, next);
  report.changed.push(`${label}: agent: false removed (routes are not tools)`);
}

/** `tools: [{ route }, action()]` → `actions: [action()]`: a module declares only what it offers. */
function migrateAgentFile(file: string, label: string, report: MigrationReport): void {
  const source = readFileSync(file, "utf8");
  if (!/\btools\s*:\s*\[/.test(source)) return;
  const next = source
    .replace(/\btools\s*:\s*\[/, "actions: [")
    .replace(/^\s*\{\s*route:[^\n]*\},?\s*\n/gm, "");
  writeFileSync(file, next);
  report.changed.push(`${label}: tools → actions, route entries removed (routes are not tools)`);
  if (/\broute\s*:/.test(next)) report.todos.push(`${label}: a route entry spans several lines — delete it by hand; routes are the API, not tools`);
}

const RUNTIME_HELPER = `import type { RequestHandler } from "express";
import type { BackendCtx } from "@tulipes/core/boot";

/**
 * Written by \`tulipes migrate 0.11\`: the 0.10 \`runtime()\` of defineRoutes,
 * kept so a routes file that built middleware from the environment keeps
 * working unchanged — the build runs on the first request, never while the
 * routes are inspected. TODO 0.11: settings are live at ctx.config and the
 * environment is resolved before routes build, so most of this can become
 * plain code; see the reference app's security routes.
 */
export function runtime<T>(ctx: BackendCtx, build: (ctx: BackendCtx) => Promise<T>) {
  let pending: Promise<T> | undefined;
  return (pick: (value: T) => RequestHandler): RequestHandler => (req, res, next) => {
    pending ??= build(ctx);
    pending.then((value) => pick(value)(req, res, next), next);
  };
}
`;

// ── every file ────────────────────────────────────────────────────────────

const SPECIFIER = /((?:from|import)\s*\(?\s*['"])(\.{1,2}\/[^'"]+?)\.js(['"])/g;

export function rewriteSpecifiers(source: string): string {
  return source.replace(SPECIFIER, "$1$2.ts$3");
}

/** `constructor(private readonly ctx: Ctx) {}` → a declared field assigned in the body. */
export function rewriteParameterProperties(source: string, file: string, report: MigrationReport): string {
  let next = source;
  let from = 0;
  let touched = false;
  for (;;) {
    const match = /^([ \t]*)constructor\(/m.exec(next.slice(from));
    if (!match) break;
    const open = from + match.index + match[0].length - 1;
    // The parameter list, by depth: types carry parentheses and commas of their own.
    let depth = 0;
    let close = -1;
    for (let i = open; i < next.length; i++) {
      if (next[i] === "(") depth++;
      else if (next[i] === ")") { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close === -1) break;
    const list = next.slice(open + 1, close);
    const params = splitEntries(list);
    const fields = params.map((part) => /^((?:(?:private|public|protected)\s+)?(?:readonly\s+)?)(\w+)\s*:\s*([\s\S]+)$/.exec(part.trim())).filter((parsed): parsed is RegExpExecArray => parsed !== null)
      .map((parsed) => ({ modifiers: parsed[1]!.trim(), name: parsed[2]!, type: parsed[3]!.trim().replace(/\s+/g, " "), property: parsed[1]!.trim().length > 0 }));
    const brace = /^\s*\{([ \t]*\})?/.exec(next.slice(close + 1));
    if (fields.length !== params.length || !fields.some((field) => field.property) || !brace) {
      from = close + 1;
      continue;
    }
    const indent = match[1]!;
    const empty = brace[1] !== undefined;
    const declarations = fields.filter((field) => field.property).map((field) => `${indent}${field.modifiers} ${field.name}: ${field.type};`);
    const assignments = fields.filter((field) => field.property).map((field) => `${indent}  this.${field.name} = ${field.name};`);
    const signature = fields.map((field) => `${field.name}: ${field.type}`).join(", ");
    const replacement = `${declarations.join("\n")}\n\n${indent}constructor(${signature}) {\n${assignments.join("\n")}${empty ? `\n${indent}}` : ""}`;
    next = next.slice(0, from + match.index) + replacement + next.slice(close + 1 + brace[0].length);
    from = from + match.index + replacement.length;
    touched = true;
  }
  if (touched) report.todos.push(`${file}: parameter properties became declared fields (native type stripping refuses them)`);
  return next;
}

/** `await inspectRoutes({ rootDir })` (0.10) → the context of an inspection boot. */
export function rewriteInspection(source: string): string {
  if (!source.includes("inspectRoutes")) return source;
  let next = source;
  for (;;) {
    const start = next.indexOf("await inspectRoutes(");
    if (start === -1) break;
    // The call's closing parenthesis, by depth.
    let depth = 0;
    let end = -1;
    for (let i = start + "await inspectRoutes".length; i < next.length; i++) {
      if (next[i] === "(") depth++;
      else if (next[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) break;
    const inner = next.slice(start + "await inspectRoutes(".length, end).trim();
    const options = inner.startsWith("{") ? inner.slice(1, -1).trim() : "";
    next = next.slice(0, start) + `(await boot({ inspect: true, mode: "backend", handleSignals: false, ${options.replace(/,\s*$/, "")} })).ctx` + next.slice(end + 1);
  }
  return next.replace(/\binspectRoutes,\s*/g, "").replace(/,\s*inspectRoutes\b/g, "");
}

// ── helpers ───────────────────────────────────────────────────────────────

/** The offset just after the last import statement, multi-line imports included. */
function importHeaderEnd(source: string): number {
  const lines = source.split("\n");
  let offset = 0;
  let end = 0;
  let open = false;
  for (const line of lines) {
    const next = offset + line.length + 1;
    if (open) {
      if (/\bfrom\s+['"][^'"]+['"];?\s*$/.test(line) || /^\s*\}\s*;?\s*$/.test(line)) { open = false; end = next; }
    } else if (/^import\b/.test(line)) {
      if (/\bfrom\s+['"][^'"]+['"];?\s*$/.test(line) || /^import\s+['"][^'"]+['"];?\s*$/.test(line)) end = next;
      else open = true;
    } else if (line.trim() && !line.trim().startsWith("//") && end > 0 && !open) {
      break;
    }
    offset = next;
  }
  return end;
}

export function walkTs(dir: string): string[] {
  const files: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(path);
    }
  };
  visit(dir);
  return files.sort();
}

function camel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file: string, value: unknown): void => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
void renameSync;
