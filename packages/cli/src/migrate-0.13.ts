import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { minimalTemplate, NAME_TOKEN, productionTemplate, readVersions } from "./template.ts";

/**
 * `tulipes migrate 0.13` — the MCP process, added to an app on 0.12.
 *
 * Additive and idempotent: it writes what a 0.13 scaffold has and the app
 * lacks, and changes nothing that exists.
 *
 *   - `mcp.ts`, as `tulipes init` writes it;
 *   - `config/mcp.config.ts`: identifying through the auth module when it
 *     exports `identifyCredential`, otherwise `developmentIdentity("MCP_ROLE")`
 *     (refused in production) and a TODO;
 *   - the `mcp` script, `@tulipes/mcp` as a dependency, `mcp.ts` in the
 *     tsconfig's `include`.
 *
 * An app's auth module is its own code, so API tokens are not written into
 * it: the report lists the reference app's files to copy.
 */
export interface Migration013Report {
  changed: string[];
  todos: string[];
}

/** What the reference app's auth module gained in 0.13, for an app to copy by hand. */
const AUTH_FILES = [
  "modules/auth/models/api-token.model.ts",
  "modules/auth/helpers/api-tokens.ts",
  "modules/auth/helpers/passport.ts (identifyCredential, authenticate(ctx))",
  "modules/auth/helpers/session-cache.ts (token identities, forgetUser)",
  "modules/auth/controllers, routes, schemas, i18n (the /auth/tokens endpoints)",
  "modules/auth/module.acl.ts (\"auth:web:tokens:*\" for user)",
];

export function migrate013(rootDir: string): Migration013Report {
  const report: Migration013Report = { changed: [], todos: [] };
  const pkgFile = join(rootDir, "package.json");
  if (!existsSync(pkgFile)) throw new Error(`tulipes migrate 0.13: no package.json in ${rootDir}`);
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const name = (pkg.name ?? "app").replace(/^@[^/]+\//, "");

  const write = (rel: string, contents: string) => {
    const path = join(rootDir, rel);
    if (existsSync(path)) return;
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents.replaceAll(NAME_TOKEN, name));
    report.changed.push(`${rel}: added`);
  };

  write("mcp.ts", readFileSync(join(minimalTemplate().dir, "mcp.ts"), "utf8"));

  const authLib = join(rootDir, "modules/auth/lib/index.ts");
  const identifies = existsSync(authLib) && /\bidentifyCredential\b/.test(readFileSync(authLib, "utf8"));
  if (!existsSync(join(rootDir, "config/mcp.config.ts"))) {
    if (identifies) {
      write("config/mcp.config.ts", readFileSync(join(productionTemplate().dir, "config/mcp.config.ts"), "utf8"));
    } else {
      write("config/mcp.config.ts", readFileSync(join(minimalTemplate().dir, "config/mcp.config.ts"), "utf8"));
      if (existsSync(join(rootDir, "modules/auth"))) {
        report.todos.push("config/mcp.config.ts identifies by MCP_ROLE (development only): copy API tokens from the reference app's auth module, then identify with identifyCredential — " + AUTH_FILES.join("; "));
      }
    }
  }

  let manifestChanged = false;
  pkg.scripts ??= {};
  if (!pkg.scripts.mcp) {
    pkg.scripts.mcp = "node mcp.ts";
    report.changed.push('package.json: scripts.mcp = "node mcp.ts"');
    manifestChanged = true;
  }
  if (!pkg.dependencies?.["@tulipes/mcp"]) {
    const range = pkg.devDependencies?.["@tulipes/mcp"] ?? `^${readVersions()["@tulipes/mcp"]}`;
    if (pkg.devDependencies?.["@tulipes/mcp"]) delete pkg.devDependencies["@tulipes/mcp"];
    pkg.dependencies = Object.fromEntries(Object.entries({ ...pkg.dependencies, "@tulipes/mcp": range }).sort(([a], [b]) => a.localeCompare(b)));
    report.changed.push(`package.json: dependencies["@tulipes/mcp"] = "${range}" (mcp.ts runs in production)`);
    manifestChanged = true;
  }
  if (manifestChanged) writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");

  const tsconfigFile = join(rootDir, "tsconfig.json");
  if (existsSync(tsconfigFile)) {
    const tsconfig = JSON.parse(readFileSync(tsconfigFile, "utf8")) as { include?: string[] };
    if (tsconfig.include && !tsconfig.include.includes("mcp.ts")) {
      tsconfig.include.splice(tsconfig.include.indexOf("app.ts") + 1, 0, "mcp.ts");
      writeFileSync(tsconfigFile, JSON.stringify(tsconfig, null, 2) + "\n");
      report.changed.push('tsconfig.json: include "mcp.ts"');
    }
  }
  return report;
}

export function runMigrate013(rootDir: string): void {
  let report;
  try {
    report = migrate013(rootDir);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
    return;
  }
  for (const line of report.changed) console.log(`  ${line}`);
  console.log(`\nmigrated ${report.changed.length} thing(s); ${report.todos.length} TODO(s) to review`);
  for (const todo of report.todos) console.log(`  ! ${todo}`);
  console.log(
    [
      "",
      "next:",
      "  pnpm install && pnpm typecheck",
      "  pnpm mcp                    # serve the modules' actions on stdio; config/mcp.config.ts says who is calling",
      "  claude mcp add <name> -- pnpm --silent mcp --token \"$TOKEN\"",
    ].join("\n"),
  );
}
