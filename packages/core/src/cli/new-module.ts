import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `forgex new module <name>` — scaffold the full module skeleton. The scope
 * is borrowed from an existing sibling module so the app keeps one naming
 * convention without configuring it anywhere.
 */
export async function runNewModule(rootDir: string, name: string): Promise<void> {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(`module name "${name}" is invalid — lowercase kebab-case required`);
    process.exitCode = 2;
    return;
  }

  const modulesDir = join(rootDir, "modules");
  const dir = join(modulesDir, name);
  if (existsSync(dir)) {
    console.error(`modules/${name} already exists`);
    process.exitCode = 1;
    return;
  }

  const scope = detectScope(modulesDir) ?? "@app";

  mkdirSync(join(dir, "routes"), { recursive: true });

  write(dir, "package.json", JSON.stringify({
    name: `${scope}/${name}`,
    version: "0.0.0",
    private: true,
    type: "module",
    forgex: { tier: "app", priority: 100, dependsOn: [] },
    dependencies: { "@forgex/core": "workspace:*", express: "^5" },
  }, null, 2) + "\n");

  write(dir, "meta.variables.json", JSON.stringify({ variables: [] }, null, 2) + "\n");

  write(dir, "module.config.ts", [
    `import type { Ctx } from "@forgex/core/boot";`,
    ``,
    `export default function ${camel(name)}Config(_ctx: Ctx) {`,
    `  return {};`,
    `}`,
    ``,
  ].join("\n"));

  write(dir, join("routes", `${name}.routes.ts`), [
    `import { Router } from "express";`,
    `import type { Ctx } from "@forgex/core/boot";`,
    ``,
    `export default function ${camel(name)}Routes(_ctx: Ctx): Router {`,
    `  const router = Router();`,
    ``,
    `  router.get("/${name}/ping", (_req, res) => {`,
    `    res.json({ module: "${name}" });`,
    `  });`,
    ``,
    `  return router;`,
    `}`,
    ``,
  ].join("\n"));

  console.log(`scaffolded modules/${name} (${scope}/${name})`);
  console.log(`next: yarn install && forgex sync`);
}

function detectScope(modulesDir: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(modulesDir);
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(modulesDir, entry, "package.json"), "utf8"),
      ) as { name?: string };
      if (pkg.name?.startsWith("@")) return pkg.name.split("/")[0];
    } catch {
      continue; // not a module folder
    }
  }
  return undefined;
}

function write(dir: string, file: string, content: string): void {
  writeFileSync(join(dir, file), content);
}

function camel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
