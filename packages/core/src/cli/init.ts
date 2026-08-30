import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `tulipes init [dir]` — scaffold a complete application that boots with
 * ZERO infrastructure: the generated core module declares no MONGO_URI or
 * REDIS_URL, and with no models and no queue files the pipeline skips both
 * engines legitimately. `yarn install && yarn dev` must always succeed on a
 * bare machine; databases arrive later as one meta.variables.json entry.
 *
 * Three modules ship: core (sys 0 — env contract, roles, request ids),
 * security (sys 10 — headers, pino logging, body parsing) and hello (the
 * app-tier proof route). Templates live inline, like `new module`.
 */
export async function runInit(rootDir: string, target?: string): Promise<void> {
  const dir = resolve(rootDir, target ?? ".");
  const name = sanitizeName(basename(dir));

  if (existsSync(dir) && readdirSync(dir).some((entry) => entry !== ".git")) {
    console.error(`refusing to init: ${dir} is not empty`);
    process.exitCode = 1;
    return;
  }

  const coreVersion = ownVersion();
  const files = renderProject(name, coreVersion);

  for (const [relPath, content] of files) {
    const filePath = join(dir, relPath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
    console.log(`  create ${relPath}`);
  }

  console.log([
    "",
    `Project "${name}" is ready. Next:`,
    "",
    target && target !== "." ? `  cd ${target}` : undefined,
    "  corepack enable   # once per machine — activates the pinned yarn 4",
    "  yarn install",
    "  yarn dev",
    "",
    "  → http://localhost:3000/hello",
    "",
    "No database or redis needed to boot — add MONGO_URI / REDIS_URL to",
    "modules/core/meta.variables.json when your first model or queue lands.",
  ].filter((line) => line !== undefined).join("\n"));
}

/**
 * The version of the core running this CLI. Resolved relative to this file
 * (src/cli or dist/cli — both sit two levels below the package root) since
 * the exports map deliberately doesn't expose package.json.
 */
function ownVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

function sanitizeName(raw: string): string {
  const name = raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return name || "tulipes-app";
}

const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";

function renderProject(name: string, coreVersion: string): [string, string][] {
  const core = `^${coreVersion}`;

  return [
    ["package.json", json({
      name,
      private: true,
      type: "module",
      // Pins yarn 4 through corepack; without it a global classic yarn
      // would handle the workspaces and produce a v1 lockfile.
      packageManager: "yarn@4.18.0",
      workspaces: ["modules/*"],
      scripts: {
        dev: "tulipes dev",
        worker: "tsx worker.ts",
        sync: "tulipes sync",
        check: "tulipes env:check",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        "@tulipes/core": core,
        express: "^5",
      },
      devDependencies: {
        "@types/express": "^5",
        "@types/node": "^24",
        tsx: "^4",
        typescript: "^7",
      },
    })],

    ["tsconfig.json", json({
      compilerOptions: {
        target: "ES2023",
        lib: ["ES2023"],
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noUncheckedIndexedAccess: true,
        verbatimModuleSyntax: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        noEmit: true,
      },
      include: ["app.ts", "worker.ts", "types", "modules", "config"],
    })],

    [".yarnrc.yml", [
      `nodeLinker: node-modules`,
      ``,
      `# tsx (esbuild) and bullmq's native helpers need their install scripts;`,
      `# stated explicitly so a restrictive global yarn config can't break dev.`,
      `enableScripts: true`,
      ``,
      `# Yarn's release-age gate quarantines freshly published packages, which`,
      `# would block brand-new @tulipes releases from installing. Preapprove the`,
      `# framework scope only — the gate stays active for everything else.`,
      `npmPreapprovedPackages:`,
      `  - "@tulipes/*"`,
      ``,
    ].join("\n")],

    [".gitignore", [
      "node_modules/",
      "dist/",
      "*.log",
      "",
      "# local env overrides — the committed .envs/.env.<mode> files hold",
      "# dev defaults; real secrets ride the container environment",
      ".env.local",
      ".envs/.env.*.local",
      "",
    ].join("\n")],

    ["app.ts", [
      `import { boot } from "@tulipes/core/boot";`,
      ``,
      `await boot({ rootDir: import.meta.dirname, mode: "web" });`,
      ``,
    ].join("\n")],

    ["worker.ts", [
      `import { boot } from "@tulipes/core/boot";`,
      ``,
      `// Worker mode refuses to start until at least one module registers a`,
      `// queue processor — a consumer with nothing to consume is a`,
      `// misconfigured deployment, not a valid idle state.`,
      `await boot({ rootDir: import.meta.dirname, mode: "worker" });`,
      ``,
    ].join("\n")],

    ["config/app.config.ts", [
      `import type { AppConfigFn } from "@tulipes/core/boot";`,
      ``,
      `/**`,
      ` * ── The app-wide config seed ──────────────────────────────────────────`,
      ` *`,
      ` * Runs FIRST in boot phase 6, before any module.config.ts factory, and`,
      ` * whatever it returns becomes the base of the global config. Every`,
      ` * module then reads it through \`ctx.config.<key>\`:`,
      ` *`,
      ` *   export default function usersRoutes({ config }: Ctx) {`,
      ` *     const router = Router();`,
      ` *     router.get(\`\${config.api!.prefix}/users\`, handler);`,
      ` *   }`,
      ` *`,
      ` * The framework itself reads exactly ONE field: \`app.name\`, for the`,
      ` * startup banner. Everything else below is convention — YOUR keys, read`,
      ` * by YOUR modules. Rename them, delete them, invent new ones freely;`,
      ` * nothing in core depends on them.`,
      ` *`,
      ` * Config that belongs to one feature does NOT go here — it goes in that`,
      ` * module's \`module.config.ts\`, where codegen types it automatically.`,
      ` * This file is for values two or more modules share.`,
      ` *`,
      ` * Values can be hardcoded (below) or driven by the environment. To make`,
      ` * any of them env-driven, declare the variable in a module's`,
      ` * meta.variables.json first, then read it here with`,
      ` * \`Environment.get("NAME")\` — reads of undeclared variables throw on`,
      ` * purpose, so a typo can never boot.`,
      ` */`,
      `// \`satisfies\` (not a type annotation) so TypeScript keeps the exact`,
      `// shape of this object for the augmentation at the bottom of the file.`,
      `const appConfig = ((Environment) => ({`,
      `  /**`,
      `   * Identity. \`name\` is the one field core consumes — it titles the`,
      `   * startup banner ("▲ ${name}"). The rest is yours: stamp \`version\``,
      `   * into a /health payload, switch behaviour on \`env\`, etc.`,
      `   */`,
      `  app: {`,
      `    name: ${JSON.stringify(name)},`,
      `    version: "0.1.0",`,
      `    description: "A Tulipes API",`,
      `    // development | staging | production | test — resolved from APP_ENV`,
      `    env: Environment.appEnv,`,
      `    // Read a declared variable (PORT lives in modules/core/meta.variables.json)`,
      `    port: Environment.get("PORT"),`,
      `  },`,
      ``,
      `  /**`,
      `   * Route prefixing. Modules build their paths from this instead of`,
      `   * hardcoding "/api/v1", so versioning the whole API is a one-line`,
      `   * change here: \`router.get(\\\`\${config.api!.prefix}/users\\\`, …)\`.`,
      `   */`,
      `  api: {`,
      `    prefix: "/api/v1",`,
      `    // Where the docs/collection live, if you expose them`,
      `    docsPath: "/api/docs",`,
      `  },`,
      ``,
      `  /**`,
      `   * HTTP behaviour consumed by the sys security module`,
      `   * (modules/security/routes/security.routes.ts). Change the body limit`,
      `   * or CORS origins here rather than editing that file.`,
      `   */`,
      `  http: {`,
      `    // Passed to express.json({ limit }) — a parser without a cap is a`,
      `    // memory-exhaustion invitation.`,
      `    bodyLimit: "1mb",`,
      `    // Browser origins allowed to call this API. Add a cors() middleware`,
      `    // in the security module and feed it this list.`,
      `    corsOrigins: ["http://localhost:5173"],`,
      `    // Set true behind nginx/a load balancer so req.ip is the real client`,
      `    // (app.set("trust proxy", config.http!.trustProxy)).`,
      `    trustProxy: false,`,
      `    // Seconds a request may run before you abort it, if you add a timeout`,
      `    // middleware.`,
      `    requestTimeout: 30,`,
      `  },`,
      ``,
      `  /**`,
      `   * List-endpoint defaults, so every module paginates identically and`,
      `   * no caller can ask for 10 000 rows at once.`,
      `   */`,
      `  pagination: {`,
      `    defaultLimit: 20,`,
      `    maxLimit: 100,`,
      `  },`,
      ``,
      `  /**`,
      `   * Cross-cutting security knobs. Secrets themselves never live here —`,
      `   * declare them as \`"type": "secret"\` variables in meta.variables.json`,
      `   * (redacted in logs and the banner) and read them where needed.`,
      `   */`,
      `  security: {`,
      `    // Token lifetimes for an auth module, in seconds`,
      `    accessTokenTtl: 900,        // 15 minutes`,
      `    refreshTokenTtl: 2_592_000, // 30 days`,
      `    // bcrypt/argon cost factor`,
      `    passwordRounds: 12,`,
      `    // Rate limiting, if you mount a limiter in the security module`,
      `    rateLimit: { windowSeconds: 60, max: 100 },`,
      `  },`,
      ``,
      `  /**`,
      `   * Public-facing URLs. Anything that builds a link a human will click —`,
      `   * password-reset emails, webhook callbacks, OAuth redirects — reads`,
      `   * these instead of guessing the host from a request.`,
      `   */`,
      `  urls: {`,
      `    api: \`http://localhost:\${Environment.get("PORT")}\`,`,
      `    frontend: "http://localhost:5173",`,
      `  },`,
      ``,
      `  /**`,
      `   * Upload constraints shared by every module that accepts files.`,
      `   */`,
      `  uploads: {`,
      `    maxSizeMb: 10,`,
      `    allowedMimeTypes: ["image/png", "image/jpeg", "application/pdf"],`,
      `  },`,
      ``,
      `  /**`,
      `   * Feature flags. Cheap way to ship dark code: a module checks`,
      `   * \`config.features!.signup\` before mounting a route. Flip per`,
      `   * environment by reading a declared boolean variable instead of a`,
      `   * literal.`,
      `   */`,
      `  features: {`,
      `    signup: true,`,
      `    maintenanceMode: false,`,
      `  },`,
      ``,
      `  /**`,
      `   * Localization defaults for modules that render text (emails, errors).`,
      `   */`,
      `  i18n: {`,
      `    defaultLocale: "en",`,
      `    supportedLocales: ["en", "fr"],`,
      `  },`,
      `})) satisfies AppConfigFn;`,
      ``,
      `export default appConfig;`,
      ``,
      `/**`,
      ` * Types the keys above at every call site: \`ctx.config.api?.prefix\` is a`,
      ` * string, not \`unknown\`. \`tulipes sync\` does this automatically for`,
      ` * module.config.ts factories; the app-level seed types itself here.`,
      ` * Optional (Partial) because the config object is empty until this`,
      ` * factory has run.`,
      ` */`,
      `declare module "@tulipes/core/config" {`,
      `  interface GlobalConfig extends Partial<ReturnType<typeof appConfig>> {}`,
      `}`,
      ``,
    ].join("\n")],

    [".envs/.env.development", [
      `# Development mode — committed on purpose; values here are dev defaults.`,
      `# Real deployments inject variables through the container environment,`,
      `# which always wins over this file.`,
      ``,
      `PORT=3000`,
      `LOG_LEVEL=debug`,
      ``,
    ].join("\n")],

    // ── modules/core — sys tier, priority 0: the very first router ─────────
    ["modules/core/package.json", json({
      name: `@app/core`,
      version: "0.0.0",
      private: true,
      type: "module",
      tulipes: { tier: "sys", priority: 0 },
      dependencies: { "@tulipes/core": core },
    })],

    ["modules/core/meta.variables.json", json({
      variables: [
        {
          name: "PORT",
          type: "number",
          group: "http",
          description: "HTTP port the web process listens on",
          default: 3000,
        },
      ],
    })],

    ["modules/core/module.acl.ts", [
      `import type { AclBuilder } from "@tulipes/core/acl";`,
      ``,
      `/**`,
      ` * The sys core module owns the global role vocabulary. Business modules`,
      ` * never define roles — they attach grants to these.`,
      ` */`,
      `export default function coreAcl(acl: AclBuilder): void {`,
      `  acl.defineRole("admin").defineRole("user");`,
      ``,
      `  // admin can do everything, per resource-namespace wildcard rules.`,
      `  acl.allow("admin", "*");`,
      `}`,
      ``,
    ].join("\n")],

    ["modules/core/routes/core.routes.ts", [
      `import { randomUUID } from "node:crypto";`,
      `import type { Ctx } from "@tulipes/core/boot";`,
      ``,
      `/**`,
      ` * Global middleware lives HERE: the core module is tier "sys",`,
      ` * priority 0 — the first router of the whole pipeline — so mounting on`,
      ` * ctx.app puts this ahead of everything, security's stack included.`,
      ` */`,
      `export default function coreRoutes({ app }: Ctx): void {`,
      `  app!.use((_req, res, next) => {`,
      `    res.setHeader("X-Request-Id", randomUUID());`,
      `    next();`,
      `  });`,
      `}`,
      ``,
    ].join("\n")],

    // ── modules/security — sys tier, priority 10: the hardening stack ──────
    ["modules/security/package.json", json({
      name: `@app/security`,
      version: "0.0.0",
      private: true,
      type: "module",
      tulipes: { tier: "sys", priority: 10 },
      dependencies: {
        "@tulipes/core": core,
        express: "^5",
        pino: "^9",
        "pino-http": "^10",
        "pino-pretty": "^13",
      },
    })],

    ["modules/security/meta.variables.json", json({
      variables: [
        {
          name: "LOG_LEVEL",
          type: "enum",
          enum: ["fatal", "error", "warn", "info", "debug", "trace"],
          group: "logging",
          description: "Minimum pino log level",
          default: "info",
        },
      ],
    })],

    ["modules/security/helpers/security-headers.ts", [
      `import type { RequestHandler } from "express";`,
      ``,
      `/**`,
      ` * Baseline hardening applied to every response before anything else`,
      ` * runs. Dependency-free — swap in the full helmet suite here if this`,
      ` * app ever needs it.`,
      ` */`,
      `export function securityHeaders(): RequestHandler {`,
      `  return (_req, res, next) => {`,
      `    res.setHeader("X-Content-Type-Options", "nosniff");`,
      `    res.setHeader("X-Frame-Options", "DENY");`,
      `    res.setHeader("Referrer-Policy", "no-referrer");`,
      `    // An API serves no active content; a restrictive CSP costs nothing`,
      `    // and defuses any HTML-ish response a bug might produce.`,
      `    res.setHeader("Content-Security-Policy", "default-src 'none'");`,
      `    next();`,
      `  };`,
      `}`,
      ``,
    ].join("\n")],

    ["modules/security/helpers/logger.ts", [
      `import { pino, type Logger } from "pino";`,
      `import type { Environment } from "@tulipes/core/env";`,
      ``,
      `let instance: Logger | undefined;`,
      ``,
      `/**`,
      ` * The app's pino logger — JSON lines in production, pretty-printed in`,
      ` * development. Level comes from LOG_LEVEL so a deploy can turn on`,
      ` * debug without a code change.`,
      ` */`,
      `export function logger(environment: Environment): Logger {`,
      `  if (instance) return instance;`,
      ``,
      `  instance = pino({`,
      `    level: String(environment.get("LOG_LEVEL")),`,
      `    ...(environment.appEnv === "development" && {`,
      `      transport: {`,
      `        target: "pino-pretty",`,
      `        options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },`,
      `      },`,
      `    }),`,
      `  });`,
      `  return instance;`,
      `}`,
      ``,
    ].join("\n")],

    ["modules/security/routes/security.routes.ts", [
      `import express from "express";`,
      `import { pinoHttp } from "pino-http";`,
      `import type { Ctx } from "@tulipes/core/boot";`,
      ``,
      `import { securityHeaders } from "../helpers/security-headers.js";`,
      `import { logger } from "../helpers/logger.js";`,
      ``,
      `/**`,
      ` * The app's request-hardening stack. Sys tier, so this mounts ahead of`,
      ` * every app-tier router — the framework core mounts no middleware of`,
      ` * its own; this module IS the pipeline's head.`,
      ` */`,
      `export default function securityRoutes({ app, Environment }: Ctx): void {`,
      `  app!.use(securityHeaders());`,
      ``,
      `  app!.use(`,
      `    pinoHttp({`,
      `      logger: logger(Environment),`,
      `      // The core module (priority 0) stamps X-Request-Id first — reuse`,
      `      // it so log lines and response headers tell one story.`,
      `      genReqId: (_req, res) => String(res.getHeader("X-Request-Id") ?? ""),`,
      `      serializers: {`,
      `        req: (req: { method: string; url: string }) => ({`,
      `          method: req.method,`,
      `          url: req.url,`,
      `        }),`,
      `        res: (res: { statusCode: number }) => ({ status: res.statusCode }),`,
      `      },`,
      `    }),`,
      `  );`,
      ``,
      `  // Body-size cap is a security control too — a parser without a limit`,
      `  // is a memory-exhaustion invitation.`,
      `  app!.use(express.json({ limit: "1mb" }));`,
      `}`,
      ``,
    ].join("\n")],

    // ── modules/hello — app tier: the proof route ──────────────────────────
    ["modules/hello/package.json", json({
      name: `@app/hello`,
      version: "0.0.0",
      private: true,
      type: "module",
      tulipes: { tier: "app", priority: 100, dependsOn: [] },
      dependencies: { "@tulipes/core": core, express: "^5" },
    })],

    ["modules/hello/routes/hello.routes.ts", [
      `import { Router } from "express";`,
      `import type { Ctx } from "@tulipes/core/boot";`,
      ``,
      `export default function helloRoutes({ config }: Ctx): Router {`,
      `  const router = Router();`,
      ``,
      `  router.get("/hello", (_req, res) => {`,
      `    res.json({ hello: "world", app: config.app?.name });`,
      `  });`,
      ``,
      `  return router;`,
      `}`,
      ``,
    ].join("\n")],

    ["README.md", [
      `# ${name}`,
      ``,
      `A [Tulipes](https://www.npmjs.com/package/@tulipes/core) application.`,
      ``,
      `## Run`,
      ``,
      "```sh",
      `corepack enable   # once per machine — activates the pinned yarn 4`,
      `yarn install`,
      `yarn dev          # boot the web process → http://localhost:3000/hello`,
      "```",
      ``,
      `Boots with no database and no redis: the pipeline skips engines no`,
      `module asks for. When your first model lands, declare \`MONGO_URI\``,
      `(type \`url\`, required) in \`modules/core/meta.variables.json\` and set`,
      `it in \`.envs/.env.development\`; same with \`REDIS_URL\` for queues.`,
      ``,
      `## Daily commands`,
      ``,
      `| command | does |`,
      `|---|---|`,
      `| \`yarn dev\` | regenerate types, run web process under tsx watch |`,
      `| \`yarn worker\` | run the queue-consumer process (needs a queue first) |`,
      `| \`yarn sync\` | regenerate \`types/config.d.ts\` + \`.env.example\` |`,
      `| \`yarn check\` | validate env against every module contract — CI gate |`,
      `| \`yarn tulipes new module <name>\` | scaffold a module |`,
      ``,
    ].join("\n")],
  ];
}
