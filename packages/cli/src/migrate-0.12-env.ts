import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { walkTs } from "./migrate.ts";

/**
 * `tulipes migrate 0.12`, the environment step — a 0.11 module's variables
 * become its config values.
 *
 * In 0.11 a module declared `tulipes.env` as an array of `{ name, … }` and
 * code read a value with `ctx.Environment.get("NAME")`. In 0.12 the
 * declaration is an object keyed by the camelCase name the value is read
 * under, `key` names the variable, and the value is `ctx.config.<module>.<name>`
 * beside the module's settings. This step:
 *
 *   1. rewrites every module's declaration (`MONGO_URI` → `mongoUri`), and
 *      remembers which module owns which variable;
 *   2. rewrites every read it can see — `x.Environment.get("K")`,
 *      `x.Environment.store.has("K")`, `x.Environment.appEnv`, the same
 *      through a destructured `Environment`, a parameter typed
 *      `Environment`, and `handle.env` — and passes a context where an
 *      `Environment` was passed as a value;
 *   3. wires `config/app.config.ts`: `server.port`, `mongoose.uri` and
 *      `bullmq.redisUrl` from the variables the app declared for them.
 *
 * What it cannot read — a variable name built at runtime, a `store.set()`
 * in a test, an `Environment` passed where no context is in scope — is a
 * TODO naming the file and the replacement. Idempotent: an object-form
 * declaration and a file with no `Environment` are left alone.
 */

export interface EnvMigrationOutcome {
  changed: string[];
  todos: string[];
  /** Per module: variable → the config name it is read under. */
  env: Record<string, Record<string, string>>;
}

/** A 0.11 entry: the variable was its own name. */
interface LegacySpec { name: string; [field: string]: unknown }

/** Who declares a variable, and under which config name. */
interface Owner { module: string; name: string }

const UPPER_SNAKE = /^[A-Z][A-Z0-9_]*$/;
const WELL_KNOWN_WIRING: Record<string, { path: string; line: (value: string) => string }> = {
  PORT: { path: "server", line: (value) => `server: { port: ${value} },` },
  MONGO_URI: { path: "mongoose", line: (value) => `mongoose: { uri: ${value} },` },
  REDIS_URL: { path: "bullmq", line: (value) => `bullmq: { redisUrl: ${value} },` },
};

export function migrateEnv(rootDir: string): EnvMigrationOutcome {
  const outcome: EnvMigrationOutcome = { changed: [], todos: [], env: {} };
  const owners = rewriteDeclarations(rootDir, outcome);
  for (const file of walkTs(rootDir)) rewriteReads(rootDir, file, owners, outcome);
  wireAppConfig(rootDir, owners, outcome);
  return outcome;
}

/** `MONGO_URI` → `mongoUri`, `PORT` → `port`. */
export function configNameOf(variable: string): string {
  return variable
    .toLowerCase()
    .split("_")
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

// ── 1. declarations ──────────────────────────────────────────────────────

function rewriteDeclarations(rootDir: string, outcome: EnvMigrationOutcome): Map<string, Owner> {
  const owners = new Map<string, Owner>();
  const modulesDir = join(rootDir, "modules");
  if (!existsSync(modulesDir)) return owners;

  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = join(modulesDir, entry.name, "package.json");
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, "utf8")) as { name?: string; tulipes?: { env?: unknown } };
    const module = (manifest.name ?? entry.name).split("/").at(-1)!;
    const declared = manifest.tulipes?.env;
    if (!declared) continue;

    if (Array.isArray(declared)) {
      const converted: Record<string, Record<string, unknown>> = {};
      for (const { name, ...rest } of declared as LegacySpec[]) {
        // `key` first, so the manifest reads "this value, from that variable".
        converted[configNameOf(name)] = { key: name, ...rest };
      }
      manifest.tulipes!.env = converted;
      writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
      outcome.changed.push(`modules/${entry.name}/package.json: ${declared.length} variable(s) keyed by config name`);
    }

    // Object form, converted just now or already: every entry has an owner.
    for (const [name, spec] of Object.entries(manifest.tulipes!.env as Record<string, { key: string }>)) {
      owners.set(spec.key, { module, name });
      (outcome.env[module] ??= {})[spec.key] = name;
    }
  }
  return owners;
}

// ── 2. reads ─────────────────────────────────────────────────────────────

/** `ctx.config.core.port` for a variable with an owner, else undefined. */
function configPath(variable: string, receiver: string, owners: Map<string, Owner>): string | undefined {
  const owner = owners.get(variable);
  // `!`: the namespace exists once the app boots; its type says it may not.
  return owner ? `${receiver}.config.${owner.module}!.${owner.name}` : undefined;
}

function rewriteReads(rootDir: string, file: string, owners: Map<string, Owner>, outcome: EnvMigrationOutcome): void {
  const source = readFileSync(file, "utf8");
  if (!/\bEnvironment\b|\.env\.(get|appEnv)\b|\} = \w+\.env;/.test(source)) return;
  const label = relative(rootDir, file);
  const todos: string[] = [];
  const unknown = (variable: string) => todos.push(`${label}: reads "${variable}", which no module declares — declare it or read the owning module's config`);

  let next = source;
  const literalRead = (receiver: string, variable: string, original: string) => configPath(variable, receiver, owners) ?? (unknown(variable), original);

  // `x.Environment.get("K")`, `x.Environment.store.has("K")`, `x.Environment.appEnv`,
  // for any receiver chain: ctx, this.ctx, app.handle.ctx.
  next = next.replace(/([\w$]+(?:\.[\w$]+)*)\.Environment\.get\(\s*(["'])([A-Z][A-Z0-9_]*)\2\s*\)/g, (match, receiver: string, _q: string, variable: string) => literalRead(receiver, variable, match));
  next = next.replace(/([\w$]+(?:\.[\w$]+)*)\.Environment\.store\.has\(\s*(["'])([A-Z][A-Z0-9_]*)\2\s*\)/g, (match, receiver: string, _q: string, variable: string) => {
    const path = configPath(variable, receiver, owners);
    return path ? `(${path} !== undefined)` : (unknown(variable), match);
  });
  next = next.replace(/([\w$]+(?:\.[\w$]+)*)\.Environment\.appEnv\b/g, "$1.appEnv");

  // `handle.env`: the boot handle no longer carries one; the context does.
  next = next.replace(/([\w$]+)\.env\.get\(\s*(["'])([A-Z][A-Z0-9_]*)\2\s*\)/g, (match, handle: string, _q: string, variable: string) => literalRead(`${handle}.ctx`, variable, match));
  next = next.replace(/([\w$]+)\.env\.appEnv\b/g, "$1.ctx.appEnv");
  next = next.replace(/(\{\s*appEnv\s*\}\s*=\s*)([\w$]+)\.env;/g, "$1$2.ctx;");

  next = rewriteDestructured(next, owners, label, todos);
  next = rewriteTypedParameters(next, owners, label, todos);

  // An `Environment` passed where a context is wanted: the receiver is the context.
  next = next.replace(/([\w$]+(?:\.[\w$]+)*)\.Environment\b(?![\w$.])/g, "$1");

  // What is left is what the rules could not read.
  for (const dynamic of next.matchAll(/\.Environment\.get\(/g)) {
    todos.push(`${label}:${lineOf(next, dynamic.index)}: a variable read by a name built at runtime — read ctx.config.<module>.<name> for each name instead`);
  }
  // The store's methods, through any name the engine was held under.
  for (const store of next.matchAll(/([\w$]+)\.store\.(set|describe|snapshot|ownerOf|sourceOf)\(/g)) {
    const [, holder, method] = store as unknown as [string, string, string];
    const hint = method === "describe" ? "ctx.settings.describeEnv(module) describes a module's values" : method === "set" ? "a value is read-only now; set the variable before the boot" : "the store is gone; ctx.settings.describeEnv(module) is what remains";
    todos.push(`${label}:${lineOf(next, store.index)}: ${holder}.store.${method}() — ${hint}`);
  }
  next = next.replace(/^import\s+(?:type\s+)?\{[^}]*\bEnvironment\b[^}]*\}\s+from\s+["']@tulipes\/core\/env["'];?\n/gm, "");
  // Prose may still say "Environment"; code may not.
  if (/\bEnvironment\b/.test(withoutComments(next))) {
    todos.push(`${label}: still mentions Environment — the engine is gone; a module reads ctx.config.<module>.<name>, a helper takes the context`);
  }

  if (next !== source) {
    writeFileSync(file, next);
    outcome.changed.push(`${label}: environment reads → ctx.config`);
  }
  outcome.todos.push(...todos);
}

/**
 * A destructured `Environment` — `const { app, Environment } = ctx;` or a
 * parameter `({ Environment, signal }: RuntimeCtx)` — read the values through
 * the source it came from. A destructured parameter becomes a plain
 * `ctx` with the other names destructured on the first line, so an
 * `Environment` passed as a value has a context to become.
 */
function rewriteDestructured(source: string, owners: Map<string, Owner>, label: string, todos: string[]): string {
  let next = source;

  // Parameter form: `function f({ a, Environment }: T) {` or `({ a, Environment }: T) => {`.
  next = next.replace(
    /(\bfunction\s+[\w$]*\s*|\(?)\(\s*\{([^}]*\bEnvironment\b[^}]*)\}(?:\s*:\s*([\w$<>, ]+))?\s*\)(\s*(?::\s*[\w$<>|, ]+)?\s*(?:=>\s*)?\{\n?)/g,
    (_match, head: string, names: string, type: string | undefined, tail: string) => {
      const others = splitNames(names).filter((name) => name !== "Environment");
      // The body's own indentation, for the destructuring line it gains.
      const indent = /\n(\s*)/.exec(tail.slice(tail.indexOf("{") + 1) + "\n") ? (/^(\s*)/.exec(tail.split("\n").at(-1) ?? "")?.[1] ?? "") : "";
      const destructure = others.length ? `${indent}  const { ${others.join(", ")} } = ctx;\n` : "";
      return `${head}(ctx${type ? `: ${type}` : ""})${tail}${destructure}`;
    },
  );

  // Local form: the source is named.
  const local = /const\s*\{([^}]*\bEnvironment\b[^}]*)\}\s*=\s*([\w$]+(?:\.[\w$]+)*);/.exec(next);
  const sourceName = local ? local[2]! : /\bEnvironment\b/.test(next) && /\(ctx: /.test(next) ? "ctx" : undefined;
  if (local) {
    const others = splitNames(local[1]!).filter((name) => name !== "Environment");
    next = next.replace(local[0], others.length ? `const { ${others.join(", ")} } = ${local[2]};` : "");
  }
  if (!sourceName) return next;

  const read = (variable: string, original: string) => configPath(variable, sourceName, owners) ?? (todos.push(`${label}: reads "${variable}", which no module declares`), original);
  next = next.replace(/(?<![\w$.])Environment\.get\(\s*(["'])([A-Z][A-Z0-9_]*)\1\s*\)/g, (match, _q: string, variable: string) => read(variable, match));
  next = next.replace(/(?<![\w$.])Environment\.store\.has\(\s*(["'])([A-Z][A-Z0-9_]*)\1\s*\)/g, (match, _q: string, variable: string) => {
    const path = configPath(variable, sourceName, owners);
    return path ? `(${path} !== undefined)` : match;
  });
  next = next.replace(/(?<![\w$.])Environment\.appEnv\b/g, `${sourceName}.appEnv`);
  // Passed as a value: the context it came from.
  next = next.replace(/(?<![\w$.])Environment\b(?![\w$.])/g, sourceName);
  return next;
}

/**
 * A helper that took the engine — `logger(environment: Environment, …)` —
 * takes the part of the context it reads: `Pick<Ctx, "config">`, plus
 * `"appEnv"` when it reads that, or the whole `Ctx` when it only keeps the
 * object as a key. Its reads move with it, and `Ctx` is imported.
 */
function rewriteTypedParameters(source: string, owners: Map<string, Owner>, label: string, todos: string[]): string {
  const parameters = [...source.matchAll(/\b([\w$]+)\s*:\s*Environment\b/g)].map((match) => match[1]!);
  if (parameters.length === 0 && !/\bEnvironment\b/.test(source)) return source;
  let next = source;

  for (const parameter of new Set(parameters)) {
    const uses = { config: false, appEnv: false };
    next = next.replace(new RegExp(`\\b${parameter}\\.get\\(\\s*(["'])([A-Z][A-Z0-9_]*)\\1\\s*\\)`, "g"), (match, _q: string, variable: string) => {
      const path = configPath(variable, parameter, owners);
      if (!path) return (todos.push(`${label}: reads "${variable}", which no module declares`), match);
      uses.config = true;
      return path;
    });
    next = next.replace(new RegExp(`\\b${parameter}\\.store\\.has\\(\\s*(["'])([A-Z][A-Z0-9_]*)\\1\\s*\\)`, "g"), (match, _q: string, variable: string) => {
      const path = configPath(variable, parameter, owners);
      if (!path) return match;
      uses.config = true;
      return `(${path} !== undefined)`;
    });
    if (new RegExp(`\\b${parameter}\\.appEnv\\b`).test(next)) uses.appEnv = true;
    const type = uses.config || uses.appEnv ? `Pick<Ctx, ${[uses.config && '"config"', uses.appEnv && '"appEnv"'].filter(Boolean).join(" | ")}>` : "Ctx";
    next = next.replace(new RegExp(`\\b${parameter}\\s*:\\s*Environment\\b`, "g"), `${parameter}: ${type}`);
  }

  // Any other type position — `WeakMap<Environment, X>` — is the context too.
  next = next.replace(/(?<![\w$.])Environment\b(?=\s*[,>|])/g, "Ctx");

  if (next !== source && /\bCtx\b/.test(next) && !/import\s+(?:type\s+)?\{[^}]*\bCtx\b[^}]*\}\s+from\s+["']@tulipes\/core\/boot["']/.test(next)) {
    next = next.replace(/^(import\s+(?:type\s+)?\{[^}]*\}\s+from\s+["']@tulipes\/core\/env["'];?\n)/m, '$1import type { Ctx } from "@tulipes/core/boot";\n');
    if (!/import type \{ Ctx \} from "@tulipes\/core\/boot"/.test(next)) {
      next = `import type { Ctx } from "@tulipes/core/boot";\n` + next;
    }
  }
  return next;
}

// ── 3. the app config ────────────────────────────────────────────────────

/**
 * Core and the providers read `server.port`, `mongoose.uri` and
 * `bullmq.redisUrl`, which 0.11 found by variable name. The seed receives
 * every module's values now, so it wires the ones the app declared.
 */
function wireAppConfig(rootDir: string, owners: Map<string, Owner>, outcome: EnvMigrationOutcome): void {
  const wiring = Object.entries(WELL_KNOWN_WIRING)
    .filter(([variable]) => owners.has(variable))
    .map(([variable, { path, line }]) => ({ path, line: line(`env.${owners.get(variable)!.module}.${owners.get(variable)!.name}`) }));
  if (wiring.length === 0) return;

  const file = [".ts", ".js"].map((ext) => join(rootDir, "config", `app.config${ext}`)).find((candidate) => existsSync(candidate));
  if (!file) {
    const lines = ["import type { AppConfigFn } from \"@tulipes/core/boot\";", "", "/** The environment wired to what core and the providers read. */", "const appConfig = ((env) => ({", ...wiring.map((entry) => `  ${entry.line}`), "})) satisfies AppConfigFn;", "", "export default appConfig;", ""];
    writeFileSync(join(rootDir, "config", "app.config.ts"), lines.join("\n"));
    outcome.changed.push(`config/app.config.ts: created, wiring ${wiring.map((entry) => entry.path).join(", ")}`);
    return;
  }

  const source = readFileSync(file, "utf8");
  const label = relative(rootDir, file);
  const missing = wiring.filter((entry) => !new RegExp(`^\\s*${entry.path}\\s*:`, "m").test(source));
  if (missing.length === 0) return;

  // The scaffold's shape: a factory of no arguments returning an object literal.
  const factory = /\(\s*\)\s*=>\s*\(\{\n/.exec(source);
  if (!factory) {
    outcome.todos.push(`${label}: give the default export an \`env\` parameter and add ${missing.map((entry) => entry.line.replace(/,$/, "")).join("; ")}`);
    return;
  }
  const indent = /\n(\s+)\S/.exec(source.slice(factory.index + factory[0].length))?.[1] ?? "  ";
  // The wiring, then a blank line, then the app's own keys.
  const block = [
    `${indent}// The environment wired to what core and the providers read (0.12).`,
    ...missing.map((entry) => `${indent}${entry.line}`),
    "",
    "",
  ].join("\n");
  let next = source.slice(0, factory.index) + "(env) => ({\n" + block + source.slice(factory.index + factory[0].length);

  // Core and the providers type these keys; the seed's own augmentation leaves them out.
  const keys = missing.map((entry) => JSON.stringify(entry.path)).join(" | ");
  next = next.replace(/Partial<ReturnType<typeof (\w+)>>/, `Partial<Omit<ReturnType<typeof $1>, ${keys}>>`);

  writeFileSync(file, next);
  outcome.changed.push(`${label}: wires ${missing.map((entry) => entry.path).join(", ")} from the environment`);
}

// ── helpers ──────────────────────────────────────────────────────────────

/** The source with line and block comments blanked, for checks that look at code only. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function splitNames(pattern: string): string[] {
  return pattern.split(",").map((name) => name.trim()).filter(Boolean);
}

function lineOf(source: string, index: number | undefined): number {
  return source.slice(0, index ?? 0).split("\n").length;
}

export { UPPER_SNAKE };
