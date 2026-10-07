import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { BootReport } from "@tulipes/core/errors";
import { readProviderDeclarations } from "@tulipes/core/boot";
import { coreVersion } from "./package-info.js";

/**
 * `tulipes new module <name>` — scaffold every contract a module can hold,
 * so the shape of a module is obvious from the folder rather than from
 * memory. Delete what this feature does not need; an absent file is always
 * valid, and deleting is faster than remembering the filename convention.
 *
 * The package scope is borrowed from an existing sibling so the app keeps
 * one naming convention without configuring it anywhere.
 *
 * Model and bootstrap files are emitted only when the app has selected a
 * models provider (`tulipes.providers.models` in its package.json): in a
 * provider-free app they would make the module require a database the app
 * refuses to boot without. `--model` / `--no-model` override the detection.
 */
export async function runNewModule(
  rootDir: string,
  name: string,
  options: { models?: boolean; queues?: boolean; sockets?: boolean } = {},
): Promise<void> {
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
  const locales = detectLocales(modulesDir);
  const declared = readProviderDeclarations(rootDir, new BootReport());
  const models = options.models ?? declared.models !== undefined;
  const queues = options.queues ?? declared.queues !== undefined;
  const sockets = options.sockets ?? declared.sockets !== undefined;

  for (const [relPath, content] of renderModule(name, scope, locales, models, queues, sockets)) {
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
      "  pnpm install     # the module is a workspace package",
      "  pnpm sync        # regenerate config types and .env.example",
      "",
      `Delete unused files; routes files stay plain functions of the context.`,
      ...(models
        ? declared.models
          ? []
          : ["", "--model was given but package.json declares no models provider: add",
             '  "tulipes": { "providers": { "models": "@tulipes/mongoose" } } and install it, or the boot will refuse this module.']
        : ["", "No models/ or bootstrap/ files: package.json declares no models provider.",
           "To add a database, declare \"tulipes\": { \"providers\": { \"models\": \"@tulipes/mongoose\" } }, install it,",
           `then \`tulipes new module ${name} --model\` in a scratch app to copy the model template.`]),
      ...(queues
        ? declared.queues
          ? []
          : ["", "--queues was given but package.json declares no queues provider: add",
             '  "tulipes": { "providers": { "queues": "@tulipes/bullmq" } } and install it, or the boot will refuse this module.']
        : ["", "No queues/ file: package.json declares no queues provider.",
           "To add background work, declare \"tulipes\": { \"providers\": { \"queues\": \"@tulipes/bullmq\" } } and install it."]),
      ...(sockets
        ? declared.sockets
          ? []
          : ["", "--sockets was given but package.json declares no sockets provider: add",
             '  "tulipes": { "providers": { "sockets": "@tulipes/socket.io" } } and install it, or the boot will refuse this module.']
        : ["", "No sockets/ file: package.json declares no sockets provider.",
           "To add realtime namespaces, declare \"tulipes\": { \"providers\": { \"sockets\": \"@tulipes/socket.io\" } } and install it."]),
    ].join("\n"),
  );
}

const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";

function renderModule(
  name: string,
  scope: string,
  locales: readonly string[],
  models: boolean,
  queues: boolean,
  sockets: boolean,
): [string, string][] {
  const fn = camel(name);
  const Model = pascal(name);

  const files: [string, string][] = [
    // One file per locale the app already ships. The module IS the i18n
    // namespace, so `req.t("title")` in this module's endpoints resolves
    // here and nowhere else. Only the default locale has to be complete —
    // gaps in the others fall back to it, and are listed in
    // `<locale>.missing.json` on the next boot.
    ...locales.map(
      (locale): [string, string] => [
        `i18n/${locale}.json`,
        json({ title: `${name} module` }),
      ],
    ),

    ["package.json", json({
      name: `${scope}/${name}`,
      version: "0.0.0",
      private: true,
      type: "module",
      // dependsOn "core" because the helpers below import from it. The npm
      // dependency makes it resolve; dependsOn makes the ordering explicit.
      tulipes: { tier: "app", priority: 100, dependsOn: ["core"] },
      dependencies: {
        "@tulipes/core": `^${coreVersion()}`,
        [`${scope}/core`]: "workspace:*",
        express: "^5",
        ...(models && { "@tulipes/mongoose": "^0.1.1", mongoose: "^8" }),
        ...(queues && { "@tulipes/bullmq": "^0.1.1" }),
        ...(sockets && { "@tulipes/socket.io": "^0.1.1" }),
      },
    })],

    ["module.config.ts", [
      `import { defineConfig } from "@tulipes/core/config";`,
      `import { z } from "zod/v4";`,
      ``,
      `/**`,
      ` * This module's settings: their shape and defaults. Values live in the`,
      ` * settings store, are edited through the console, and are read at`,
      ` * \`ctx.config.${name}\`, typed by \`pnpm sync\`. Every field needs a`,
      ` * default; tag one \`.meta({ restart: true })\` when it cannot be`,
      ` * applied without a restart. Secrets are environment variables, not`,
      ` * settings. Delete this file if the module has no settings.`,
      ` */`,
      `export default defineConfig({`,
      `  schema: z.object({`,
      `    // enabled: z.boolean().default(true).describe("Serve this module's endpoints"),`,
      `  }),`,
      `});`,
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
      `  // _acl.allow("user", "${name}:read");   // the id declared in routes/`,
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
      `import type { Request, RequestHandler, Response } from "express";`,
      `import type { Ctx } from "@tulipes/core/boot";`,
      ``,
      `import { describe${Model} } from "../helpers/${name}.helpers.js";`,
      ``,
      `/**`,
      ` * One class per controller, holding the context. Each method returns a`,
      ` * handler rather than being one, so the routes file stays a table of`,
      ` * contents and private helpers sit beside the handlers that use them.`,
      ` *`,
      ` * Taking ctx in the constructor is what makes it testable: construct`,
      ` * one with a stub context and call the method.`,
      ` */`,
      `export class ${Model}Controller {`,
      `  constructor(private readonly ctx: Ctx) {}`,
      ``,
      `  index(): RequestHandler {`,
      `    return (req: Request, res: Response): void => {`,
      `      // res.respond wraps this in the app's envelope; req.t is already`,
      `      // bound to this module's i18n namespace. rai() binds both, which`,
      `      // is one more thing a declared route buys you.`,
      `      res.respond({`,
      `        data: {`,
      `          module: describe${Model}(),`,
      `          title: req.t("title"),`,
      `          app: this.ctx.config.app?.name,`,
      `        },`,
      `      });`,
      `    };`,
      `  }`,
      `}`,
      ``,
    ].join("\n")],

    [`routes/${name}.routes.ts`, [
      `import { Router } from "express";`,
      `import type { BackendCtx } from "@tulipes/core/boot";`,
      ``,
      `import { ${Model}Controller } from "../controllers/${name}.controllers.js";`,
      ``,
      `/**`,
      ` * A plain function of the context: build the router, declare a RAI on`,
      ` * every endpoint, return it and core mounts it under config.api.prefix`,
      ` * (or call ctx.routes.mount(router, "/other")). Read models, settings and`,
      ` * the environment inside handlers, not here — inspection builds this`,
      ` * router with nothing acquired.`,
      ` */`,
      `export default function ${fn}Routes(ctx: BackendCtx): Router {`,
      `  const router = Router();`,
      `  const controller = new ${Model}Controller(ctx);`,
      `  router.get("/${name}", ctx.rai({ id: "${name}:read", name: "List ${name}" }), controller.index());`,
      `  return router;`,
      `}`,
      ``,
    ].join("\n")],

    [`models/${name}.model.ts`, [
      `import { Schema } from "mongoose";`,
      `import type { ModelDef } from "@tulipes/mongoose";`,
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
      `import type { BootstrapCleanup, RuntimeCtx } from "@tulipes/core/boot";`,
      ``,
      `/**`,
      ` * The one place this module initializes: after settings, translations`,
      ` * and ACL, before routes or queues, in every process — indexes, seed`,
      ` * rows, a client kept open. Return the cleanup for anything you open;`,
      ` * core runs it after traffic drains, in reverse load order.`,
      ` *`,
      ` * MUST be idempotent: every process runs it on every boot. Upsert,`,
      ` * never blind-insert. A seed a one-off script should skip checks`,
      ` * \`ctx.mode === "script"\`.`,
      ` */`,
      `export default async function ${fn}Bootstrap(_ctx: RuntimeCtx): Promise<BootstrapCleanup | void> {}`,
      ``,
    ].join("\n")],

    [`queues/${name}.queues.ts`, [
      `import type { Ctx } from "@tulipes/core/boot";`,
      `import type { QueueRegistry } from "@tulipes/bullmq";`,
      ``,
      `/**`,
      ` * ONE file describes both sides. The backend process registers the`,
      ` * queue so routes can produce into it; \`pnpm worker\` turns the`,
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
      `import type { SocketRegistry } from "@tulipes/socket.io";`,
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

  return files.filter(([path]) =>
    (models || (!path.startsWith("models/") && !path.startsWith("bootstrap/"))) &&
    (queues || !path.startsWith("queues/")) &&
    (sockets || !path.startsWith("sockets/")));
}

/**
 * The locales a sibling module already ships — the same trick as the
 * package scope: the app's own conventions decide, with nothing to
 * configure. `en` alone when nothing is translated yet.
 */
function detectLocales(modulesDir: string): string[] {
  const found = new Set<string>();
  let entries: string[];
  try {
    entries = readdirSync(modulesDir);
  } catch {
    return ["en"];
  }

  for (const entry of entries) {
    let files: string[];
    try {
      files = readdirSync(join(modulesDir, entry, "i18n"));
    } catch {
      continue; // that module has no translations
    }
    for (const file of files) {
      if (file.endsWith(".json") && !file.endsWith(".missing.json")) {
        found.add(file.replace(/\.json$/, ""));
      }
    }
  }

  return found.size > 0 ? [...found].sort() : ["en"];
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
