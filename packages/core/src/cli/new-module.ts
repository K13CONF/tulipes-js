import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { coreVersion } from "./package-info.js";

/**
 * `tulipes new module <name>` — scaffold every contract a module can hold,
 * so the shape of a module is obvious from the folder rather than from
 * memory. Delete what this feature does not need; an absent file is always
 * valid, and deleting is faster than remembering the filename convention.
 *
 * The package scope is borrowed from an existing sibling so the app keeps
 * one naming convention without configuring it anywhere.
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

  for (const [relPath, content] of renderModule(name, scope)) {
    const filePath = join(dir, relPath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
    console.log(`  create modules/${name}/${relPath}`);
  }

  console.log(
    [
      "",
      `scaffolded modules/${name} (${scope}/${name})`,
      "",
      "next:",
      "  yarn install     # the module is a workspace package",
      "  yarn sync        # regenerate config types and .env.example",
      "",
      `Delete any file ${name} does not need — every one of them is optional.`,
    ].join("\n"),
  );
}

const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";

function renderModule(name: string, scope: string): [string, string][] {
  const fn = camel(name);
  const Model = pascal(name);

  return [
    ["package.json", json({
      name: `${scope}/${name}`,
      version: "0.0.0",
      private: true,
      type: "module",
      // dependsOn "core" because the model below imports from it. The npm
      // dependency makes it resolve; dependsOn makes the ordering explicit.
      tulipes: { tier: "app", priority: 100, dependsOn: ["core"] },
      dependencies: {
        "@tulipes/core": `^${coreVersion()}`,
        [`${scope}/core`]: "workspace:*",
        express: "^5",
        mongoose: "^8",
      },
    })],

    // Empty on purpose: add an entry the moment this module needs a value
    // that differs per deployment, then run `yarn sync`.
    ["meta.variables.json", json({ variables: [] })],

    ["module.config.ts", [
      `import type { Ctx } from "@tulipes/core/boot";`,
      ``,
      `/**`,
      ` * Runs in boot phase 6. Whatever this returns is stored at`,
      ` * \`config.${name}\` and typed by \`yarn sync\`, so other modules read it`,
      ` * without importing anything from here.`,
      ` */`,
      `export default function ${fn}Config(_ctx: Ctx) {`,
      `  return {};`,
      `}`,
      ``,
      `/** After the process is fully up. Delete if unused. */`,
      `export async function onReady(_ctx: Ctx): Promise<void> {}`,
      ``,
      `/** Graceful shutdown, in REVERSE load order. Delete if unused. */`,
      `export async function onShutdown(_ctx: Ctx): Promise<void> {}`,
      ``,
    ].join("\n")],

    ["module.acl.ts", [
      `import type { AclBuilder } from "@tulipes/core/acl";`,
      ``,
      `/**`,
      ` * Roles are global and defined once by the sys core module; a feature`,
      ` * module only attaches grants, on resources namespaced by its own`,
      ` * name ("${name}:read", "${name}:write").`,
      ` *`,
      ` * The grant below is commented out because granting to a role this`,
      ` * app does not define is a boot crash — uncomment it once you have`,
      ` * checked which roles exist in modules/core/module.acl.ts.`,
      ` */`,
      `export default function ${fn}Acl(_acl: AclBuilder): void {`,
      `  // _acl.allow("user", "${name}:read");`,
      `}`,
      ``,
    ].join("\n")],

    [`helpers/${name}.helpers.ts`, [
      `/**`,
      ` * Pure logic: no Express, no database, no framework — trivial to unit`,
      ` * test. The framework never scans this folder; import from it`,
      ` * directly. Anything a second module needs belongs in the core`,
      ` * module instead, imported as ${scope}/core.`,
      ` */`,
      `export function describe${Model}(): string {`,
      `  return "${name}";`,
      `}`,
      ``,
    ].join("\n")],

    [`controllers/${name}.controllers.ts`, [
      `import type { Request, Response } from "express";`,
      `import type { Ctx } from "@tulipes/core/boot";`,
      ``,
      `import { describe${Model} } from "../helpers/${name}.helpers.js";`,
      ``,
      `/**`,
      ` * Controllers hold the work so routes stay a table of contents. Each`,
      ` * takes ctx and RETURNS the handler — that closure is what makes it`,
      ` * testable: pass a stub context, get a plain function.`,
      ` */`,
      `export function index(_ctx: Ctx) {`,
      `  return (_req: Request, res: Response): void => {`,
      `    res.json({ module: describe${Model}() });`,
      `  };`,
      `}`,
      ``,
    ].join("\n")],

    [`routes/${name}.routes.ts`, [
      `import { Router } from "express";`,
      `import type { Ctx } from "@tulipes/core/boot";`,
      ``,
      `import { index } from "../controllers/${name}.controllers.js";`,
      ``,
      `export default function ${fn}Routes(ctx: Ctx): Router {`,
      `  const router = Router();`,
      ``,
      `  // Built from the shared prefix, so versioning the API is one line`,
      `  // in config/app.config.ts.`,
      `  const base = String(ctx.config.api?.prefix ?? "");`,
      ``,
      `  router.get(\`\${base}/${name}\`, index(ctx));`,
      ``,
      `  return router;`,
      `}`,
      ``,
    ].join("\n")],

    [`models/${name}.model.ts`, [
      `import { Schema } from "mongoose";`,
      `import type { ModelDef } from "@tulipes/core/db";`,
      ``,
      `import { baseSchemaOptions } from "${scope}/core";`,
      ``,
      `/**`,
      ` * A declaration, never a registration: the framework compiles this on`,
      ` * its own connection and puts it in the model store. Read it anywhere`,
      ` * with models!.get("${Model}"). Never call mongoose.model() yourself.`,
      ` */`,
      `const ${fn}Schema = new Schema(`,
      `  {`,
      `    name: { type: String, required: true, trim: true },`,
      `  },`,
      `  baseSchemaOptions,`,
      `);`,
      ``,
      `export default { name: "${Model}", schema: ${fn}Schema } satisfies ModelDef;`,
      ``,
    ].join("\n")],

    [`bootstrap/${name}.bootstrap.ts`, [
      `import type { Ctx } from "@tulipes/core/boot";`,
      ``,
      `/**`,
      ` * Runs after models are registered and before the process serves —`,
      ` * indexes, seed rows, defaults.`,
      ` *`,
      ` * MUST be idempotent: it runs on every boot of every process. Upsert,`,
      ` * never blind-insert.`,
      ` */`,
      `export default async function ${fn}Bootstrap(_ctx: Ctx): Promise<void> {}`,
      ``,
    ].join("\n")],

    [`queues/${name}.queues.ts`, [
      `import type { Ctx } from "@tulipes/core/boot";`,
      `import type { QueueRegistry } from "@tulipes/core/queues";`,
      ``,
      `/**`,
      ` * ONE file describes both sides. The backend process registers the`,
      ` * queue so routes can produce into it; \`yarn worker\` turns the`,
      ` * processor into a live consumer.`,
      ` *`,
      ` * Produce from anywhere with ctx.queues:`,
      ` *   await ctx.queues!.add("${name}.example", "job", { id });`,
      ` *`,
      ` * Queue names use "." — BullMQ reserves ":" as its redis separator.`,
      ` */`,
      `export default function ${fn}Queues(_ctx: Ctx, queues: QueueRegistry): void {`,
      `  queues.define("${name}.example");`,
      ``,
      `  queues.process("${name}.example", async (job) => {`,
      `    // Jobs retry, so keep this safe to run twice. Pass ids in`,
      `    // job.data and re-read state here.`,
      `    return { handled: job.name };`,
      `  });`,
      `}`,
      ``,
    ].join("\n")],

    [`sockets/${name}.sockets.ts`, [
      `import type { Ctx } from "@tulipes/core/boot";`,
      `import type { SocketRegistry } from "@tulipes/core/sockets";`,
      ``,
      `/**`,
      ` * Backend mode only. A namespace is claimed by exactly one module;`,
      ` * emit from anywhere with ctx.sockets!.of("/${name}").`,
      ` */`,
      `export default function ${fn}Sockets(_ctx: Ctx, sockets: SocketRegistry): void {`,
      `  sockets.namespace("/${name}", (nsp) => {`,
      `    nsp.on("connection", (socket) => {`,
      `      socket.emit("ready", { module: "${name}" });`,
      `    });`,
      `  });`,
      `}`,
      ``,
    ].join("\n")],
  ];
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

function camel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function pascal(kebab: string): string {
  const c = camel(kebab);
  return c.charAt(0).toUpperCase() + c.slice(1);
}
