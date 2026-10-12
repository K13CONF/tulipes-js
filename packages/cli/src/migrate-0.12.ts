import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { isRai, RAI_SEGMENT } from "@tulipes/core/acl";

import { walkTs } from "./migrate.ts";

/**
 * `tulipes migrate 0.12` — every RAI id gains a scope.
 *
 * 0.12 ids are `module:scope:resource[:extra]`. A 0.11 app's are
 * `module:resource`, so this inserts one scope (`web` unless `--scope`
 * says otherwise) into:
 *
 *   - every `id: "a:b"` in `routes/` (any depth) and `agent/`;
 *   - every two-segment grant inside an `allow(...)` call in
 *     `module.acl.ts` (`"a:*"` and `"*"` are already valid and stay);
 *   - every other string literal in the app's TypeScript that is exactly
 *     one of the ids rewritten above — an access check written by hand,
 *     an assertion in a test.
 *
 * It renames no file: scope-first names are a convention, not a contract.
 * What it cannot read — an id built at runtime — is a TODO line in the
 * report and in the record; no comment is written into the file. Idempotent: an id that already has a scope is left alone.
 *
 * The one judgement it leaves to a person is which ids belong to another
 * scope: everything lands in one, and moving the back office to `bo` is a
 * rename of the id, its grants and its references, by hand.
 */
export interface Migration012Report {
  scope: string;
  changed: string[];
  todos: string[];
  /** Every id rewritten, old → new. */
  ids: Record<string, string>;
}

const TWO_SEGMENTS = /^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*$/;

/**
 * Where an id is declared. In a routes file only inside `rai({ … })`, so a
 * zod field or a payload named `id` is never mistaken for one; an agent
 * file holds nothing but declarations, so any `id:` there is an action's.
 */
const PATTERNS = {
  routes: {
    literal: /(\brai\s*\(\s*\{[^{}]*?\bid\s*:\s*)(["'])([^"'\n]*)\2/g,
    computed: /\brai\s*\(\s*\{[^{}]*?\bid\s*:\s*(?:`|[A-Za-z_$])/g,
  },
  agent: {
    literal: /(\bid\s*:\s*)(["'])([^"'\n]*)\2/g,
    computed: /\bid\s*:\s*(?:`|[A-Za-z_$])/g,
  },
} as const;

export function migrate012(rootDir: string, options: { scope?: string } = {}): Migration012Report {
  const scope = options.scope ?? "web";
  if (!RAI_SEGMENT.test(scope)) {
    throw new Error(`--scope "${scope}" is not a scope — lowercase, starting with a letter ([a-z][a-z0-9-]*)`);
  }
  const report: Migration012Report = { scope, changed: [], todos: [], ids: {} };
  const scoped = (id: string): string => {
    const [module, resource] = id.split(":") as [string, string];
    return `${module}:${scope}:${resource}`;
  };

  const modulesDir = join(rootDir, "modules");
  const modules = existsSync(modulesDir)
    ? readdirSync(modulesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort()
    : [];

  const declarations = new Set<string>();

  // ── declarations: routes (any depth) and agent actions ────────────────
  for (const name of modules) {
    const dir = join(modulesDir, name);
    const files = [
      ...(existsSync(join(dir, "routes")) ? walkTs(join(dir, "routes")).map((file) => [file, PATTERNS.routes] as const) : []),
      ...(existsSync(join(dir, "agent")) ? walkTs(join(dir, "agent")).map((file) => [file, PATTERNS.agent] as const) : []),
    ];
    for (const [file, pattern] of files) {
      declarations.add(file);
      const label = relative(rootDir, file);
      const source = readFileSync(file, "utf8");
      let count = 0;

      const next = source.replace(pattern.literal, (match, head: string, quote: string, id: string) => {
        if (isRai(id)) return match;
        if (!TWO_SEGMENTS.test(id)) {
          report.todos.push(`${label}: id "${id}" is neither a 0.11 id nor a 0.12 one — rewrite it as module:scope:resource[:extra]`);
          return match;
        }
        const target = scoped(id);
        if (!isRai(target)) {
          report.todos.push(`${label}: id "${id}" cannot take a scope as is — every segment must start with a letter ("${target}")`);
          return match;
        }
        report.ids[id] = target;
        count++;
        return `${head}${quote}${target}${quote}`;
      });

      for (const computed of source.matchAll(pattern.computed)) {
        const line = source.slice(0, computed.index).split("\n").length;
        report.todos.push(`${label}:${line}: an id built at runtime — make sure it produces module:scope:resource[:extra]`);
      }

      if (next !== source) {
        writeFileSync(file, next);
        report.changed.push(`${label}: ${count} id(s) scoped`);
      }
    }
  }

  // ── grants: two-segment literals inside allow(...) ────────────────────
  for (const name of modules) {
    const file = join(modulesDir, name, "module.acl.ts");
    if (!existsSync(file)) continue;
    declarations.add(file);
    const source = readFileSync(file, "utf8");
    let count = 0;
    const next = rewriteAllowCalls(source, (grant) => {
      if (!TWO_SEGMENTS.test(grant)) return grant;
      const target = report.ids[grant] ?? scoped(grant);
      if (!isRai(target)) {
        report.todos.push(`${relative(rootDir, file)}: grant "${grant}" cannot take a scope as is — every segment must start with a letter`);
        return grant;
      }
      report.ids[grant] = target;
      count++;
      return target;
    });
    if (next !== source) {
      writeFileSync(file, next);
      report.changed.push(`${relative(rootDir, file)}: ${count} grant(s) scoped`);
    }
  }

  // ── references: a literal equal to a rewritten id, anywhere else ──────
  const known = Object.keys(report.ids);
  if (known.length > 0) {
    const literal = new RegExp(`(["'\`])(${known.map(escape).join("|")})\\1`, "g");
    for (const file of walkTs(rootDir)) {
      if (declarations.has(file)) continue;
      const source = readFileSync(file, "utf8");
      let count = 0;
      const next = source.replace(literal, (_match, quote: string, id: string) => {
        count++;
        return `${quote}${report.ids[id]}${quote}`;
      });
      if (next !== source) {
        writeFileSync(file, next);
        report.changed.push(`${relative(rootDir, file)}: ${count} reference(s) to a rewritten id`);
      }
    }
  }

  const record = join(rootDir, "config", "migration-0.12.json");
  mkdirSync(dirname(record), { recursive: true });
  writeFileSync(
    record,
    JSON.stringify({ migrated_at: new Date().toISOString(), scope, ids: report.ids, todos: report.todos }, null, 2) + "\n",
  );
  report.changed.push(`wrote config/migration-0.12.json (${known.length} id(s) scoped "${scope}")`);
  return report;
}

/**
 * Applies `rewrite` to every string literal inside each `allow(...)` call,
 * and to nothing else in the file — an import specifier like "node:fs"
 * also has two segments.
 */
export function rewriteAllowCalls(source: string, rewrite: (grant: string) => string): string {
  let output = "";
  let cursor = 0;
  const call = /\ballow\s*\(/g;
  for (let match = call.exec(source); match; match = call.exec(source)) {
    const open = match.index + match[0].length;
    let depth = 1;
    let index = open;
    let quote: string | undefined;
    for (; index < source.length && depth > 0; index++) {
      const char = source[index]!;
      if (quote) {
        if (char === "\\") index++;
        else if (char === quote) quote = undefined;
      } else if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "(") depth++;
      else if (char === ")") depth--;
    }
    const args = source.slice(open, index);
    output += source.slice(cursor, open) + args.replace(/(["'])([^"'\n]*)\1/g, (_whole, q: string, value: string) => `${q}${rewrite(value)}${q}`);
    cursor = index;
    call.lastIndex = index;
  }
  return output + source.slice(cursor);
}

export async function runMigrate012(rootDir: string, options: { scope?: string }): Promise<void> {
  let report;
  try {
    report = migrate012(rootDir, options);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
    return;
  }
  for (const line of report.changed) console.log(`  ${line}`);
  const ids = Object.entries(report.ids);
  console.log(`\nscoped ${ids.length} id(s) "${report.scope}"; ${report.todos.length} TODO(s) to review`);
  for (const [from, to] of ids) console.log(`  ${from} → ${to}`);
  for (const todo of report.todos) console.log(`  ! ${todo}`);
  console.log(
    [
      "",
      "next:",
      `  every id is in scope "${report.scope}" now. Move the back office (and any other surface)`,
      "  by hand: rename the id in routes/ or agent/, its grants in module.acl.ts, and its",
      "  references — `pnpm tulipes routes` lists them, `pnpm typecheck` finds a two-segment id",
      "  optional: name routes and controllers scope-first (routes/web.users.routes.ts)",
      "  pnpm typecheck && pnpm test",
      "  review config/migration-0.12.json, then delete it",
    ].join("\n"),
  );
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
