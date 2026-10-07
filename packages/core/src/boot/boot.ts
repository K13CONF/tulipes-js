import { Cleanup } from "./cleanup.js";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import express, { type Express } from "express";

import { Environment, type AppEnv } from "../env/environment.js";
import { BootReport } from "../errors/boot-error.js";
import { discoverModules } from "../modules/discovery.js";
import { sortModules } from "../modules/graph.js";
import { exploreModules, type ModuleFiles } from "../modules/explorer.js";
import { declareConfig } from "../config/declare-config.js";
import { Settings } from "../config/settings.js";
import { FileSettingsStore, MemorySettingsStore, type SettingsStore } from "../config/settings-store.js";
import { loadAcl } from "../acl/load-acl.js";
import { errorHandler, notFoundHandler } from "../http/error-handler.js";
import { createRai, RouteRegistry } from "../http/rai.js";
import { bindRespond, warnOnRawResponse } from "../http/respond.js";
import { I18n } from "../i18n/i18n.js";
import { scanRoutes } from "../http/route-scan.js";
import { loadAgents } from "../agent/load-agents.js";
import { loadRoutes } from "./load-routes.js";
import { loadAppConfigSeed } from "./app-files.js";
import { printStartupBanner } from "./banner.js";
import { runBootstrap, type RegisteredCleanup } from "./bootstrap.js";
import {
  acquireProviders,
  attachProviders,
  checkRequirements,
  disposeProviders,
  drainProviders,
  inspectionStub,
  providerStatuses,
  readProviderDeclarations,
  serveProviders,
  type AcquiredProvider,
  type AcquiredStatus,
} from "./providers.js";
import { providerCapabilities } from "../modules/manifest.js";
import type { BackendCtx, Ctx, RuntimeCtx } from "./contracts.js";

/**
 * "script" is a one-shot mode: it runs every shared phase — environment,
 * modules, settings, ACL, database, models, bootstrap, queue registration —
 * then starts nothing at all, so a maintenance script gets exactly what a
 * request handler gets minus the server. It is deliberately the same code
 * path as the long-running modes, so a script can never be handed config
 * the real app does not have.
 */
export const processModes = ["backend", "worker", "script"] as const;
export type ProcessMode = (typeof processModes)[number];

export interface BootOptions {
  /** App root — the directory containing `modules/` and `.envs/`. */
  rootDir: string;
  /** Defaults to process.env.PROCESS_MODE, then "backend". */
  mode?: ProcessMode;
  appEnv?: AppEnv;
  /** Skip SIGTERM/SIGINT wiring — for tests that manage shutdown themselves. */
  handleSignals?: boolean;
  /**
   * Build the app and mount every route, but do not bind a port. For
   * tooling that needs the routes without taking the port from a server
   * that is already running — `tulipes routes` is the reason it exists.
   */
  listen?: boolean;
  /** Total graceful cleanup deadline, including cleanups. Defaults to 10 seconds. */
  shutdownTimeoutMs?: number;
  /**
   * Inspection: build the app and mount every route with nothing acquired —
   * the environment is declared but unresolved, declared providers are stubs
   * that throw on use, settings are their defaults in memory, bootstrap and
   * listening are skipped. What `tulipes routes` and `tulipes spec` run,
   * without a `.env`, a secret or a service.
   */
  inspect?: boolean;
}

export interface BootHandle {
  mode: ProcessMode;
  env: Environment;
  ctx: Ctx;
  /** Translations: the locales served and the module namespaces loaded. */
  i18n: I18n;
  /** Every declared provider, with its banner status, in acquisition order. */
  providers: readonly AcquiredStatus[];
  /** Worker mode: consumers started by the providers' serve() hooks. */
  consumers: number;
  app?: Express;
  server?: Server;
  shutdown: () => Promise<void>;
}

/**
 * The whole run workflow:
 *
 *   1  environment        .env.<APP_ENV> + every declared variable → validate
 *   2  module graph       tier / priority / dependsOn → load order
 *   3  exploration        conventional paths resolved, nothing imported
 *   4  declarations       config/app.config.ts seed; module.config.ts schemas
 *   5  models, settings   providers connect; no values are read yet
 *   6  settings           every namespace loaded, seeded, validated → ctx.config
 *   7  translations
 *   8  ACL
 *   9  bootstrap          bootstrap/*.bootstrap.ts in load order, every mode
 *  10  queues, sockets    providers acquired against the full context
 *  11  fork               backend | worker | script
 *  12  banner
 *
 * Each phase crashes with its aggregate report before the next begins.
 */
export async function boot(options: BootOptions): Promise<BootHandle> {
  const bootStartedAt = Date.now();
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 10_000;
  if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    throw new Error("shutdownTimeoutMs must be a positive finite number");
  }
  const mode = resolveMode(options.mode);
  if (options.inspect && mode !== "backend") throw new Error("inspection requires backend mode");
  const situation = options.inspect ? "inspect" : mode;

  // Phase 1 — Environment engine (crashes internally on bad env). Inspection
  // validates the declarations and resolves nothing.
  const env = (options.inspect ? Environment.inspection : Environment.load)({
    rootDir: options.rootDir,
    ...(options.appEnv && { appEnv: options.appEnv }),
  });

  // Phase 2 — module graph
  const graphReport = new BootReport();
  const manifests = discoverModules(join(options.rootDir, "modules"), graphReport);
  const order = sortModules(manifests, graphReport);
  graphReport.throwIfAny("module graph");

  // Phase 3 — exploration (no failure modes)
  const explored = exploreModules(order);

  // Phase 3b — provider declarations. Static, read from the app's own
  // package.json, checked against every module's requirements BEFORE any
  // module code is imported: a module that needs models in an app with no
  // models provider never gets as far as importing a schema.
  const providerReport = new BootReport();
  const declaredProviders = readProviderDeclarations(options.rootDir, providerReport);
  checkRequirements(explored, declaredProviders, providerReport);
  providerReport.throwIfAny("providers");

  // The registry exists before any module runs, so a routes file can
  // declare into it the moment it is called. The i18next instance exists
  // from here on and is never replaced; phase 7 is where resources arrive.
  const routes = new RouteRegistry();
  const i18n = new I18n();
  const settings = new Settings();
  const aborter = new AbortController();
  const ctx: Ctx = {
    mode,
    Environment: env,
    modules: order,
    config: {},
    settings,
    signal: aborter.signal,
    routes,
    rai: createRai(
      routes,
      (role, permission) => ctx.acl!.can(role, permission),
      (req, res, module) => {
        i18n.attach_(req, module);
        // Bounds live in config.pagination, so every list endpoint in the
        // app clamps identically and no caller can ask for ten thousand.
        bindRespond(req, res, ctx.config.pagination ?? {});
        if (env.appEnv === "development") warnOnRawResponse(req, res);
      },
    ),
    t: (namespace, locale) => i18n.t(namespace, locale),
    i18n: i18n.instance,
  };
  let cleanups: RegisteredCleanup[] = [];
  let shutdownPromise: Promise<void> | undefined;
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  // Per boot, never module-global: two handles in one process own two sets.
  const acquiredProviders: AcquiredProvider[] = [];
  let fileStore: FileSettingsStore | undefined;
  const handle: BootHandle = {
    mode, env, ctx, i18n,
    providers: [],
    consumers: 0,
    shutdown: () => {
      if (!shutdownPromise) {
        for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
        // Deferred by a microtask so the promise is already the handle's by
        // the time ctx.signal fires: a listener that asks for shutdown gets
        // this same operation, not a second one.
        shutdownPromise = Promise.resolve().then(() =>
          shutdown(handle, aborter, cleanups, acquiredProviders, settings, fileStore, shutdownTimeoutMs));
      }
      return shutdownPromise;
    },
  };
  const providerContext = { ctx, rootDir: options.rootDir, files: explored, situation } as const;
  try {
    // Phase 4 — declarations: the app-level seed and every module's schema.
    const declarationReport = new BootReport();
    await loadAppConfigSeed(options.rootDir, ctx, declarationReport);
    await declareConfig(explored, settings, declarationReport);
    declarationReport.throwIfAny("config");

    // Phase 5 — models and the settings store. A provider registers
    // ownership through own() before it awaits anything, so the failure
    // path below can always dispose what was created. Only the app's
    // declaration selects a provider: an installed package or a MONGO_URI
    // on its own acquires nothing. Inspection acquires nothing at all: a
    // declared capability is a stub that throws the moment it is used.
    if (options.inspect) {
      for (const capability of providerCapabilities) {
        if (!declaredProviders[capability]) continue;
        acquiredProviders.push({ capability, provider: declaredProviders[capability]!, skipped: "inspect" });
        if (capability !== "settings") (ctx as unknown as Record<string, unknown>)[capability] = inspectionStub(capability);
      }
    } else {
      const acquireReport = new BootReport();
      acquiredProviders.push(...await acquireProviders(declaredProviders, providerContext, acquireReport, ["models", "settings"]));
      handle.providers = providerStatuses(acquiredProviders);
      acquireReport.throwIfAny("providers");
    }
    handle.providers = providerStatuses(acquiredProviders);

    // Phase 6 — settings: every namespace read from the store, seeded on
    // first boot, validated against its declaration, handed to ctx.config.
    const settingsReport = new BootReport();
    const declaredStore = acquiredProviders.find((entry) => entry.capability === "settings")?.value as SettingsStore | undefined;
    const store = options.inspect
      ? new MemorySettingsStore("defaults (inspection)")
      : declaredStore ?? (fileStore = new FileSettingsStore(options.rootDir, env.appEnv));
    await settings.load(store, ctx, settingsReport);
    settingsReport.throwIfAny("settings");

    // Phase 7 — translations. After settings, because the locales an app
    // ships are app policy read from config.i18n; before everything that
    // might want to say something to a user.
    const i18nReport = new BootReport();
    await i18n.load(explored, I18n.readSettings(ctx.config.i18n, i18nReport), env.appEnv, i18nReport);
    i18nReport.throwIfAny("i18n");

    // Phase 8 — ACL merge
    const aclReport = new BootReport();
    ctx.acl = await loadAcl(explored, aclReport);
    aclReport.throwIfAny("acl");

    // Phase 9 — bootstrap, every mode. Inspection acquires nothing and so
    // runs nothing that could open a resource.
    if (!options.inspect) {
      const bootstrapReport = new BootReport();
      cleanups = await runBootstrap(explored, ctx as RuntimeCtx, bootstrapReport);
      bootstrapReport.throwIfAny("bootstrap");
    }

    // Phase 10 — queues and sockets, against the full context.
    if (!options.inspect) {
      const lateReport = new BootReport();
      acquiredProviders.push(...await acquireProviders(declaredProviders, providerContext, lateReport, ["queues", "sockets"]));
      handle.providers = providerStatuses(acquiredProviders);
      lateReport.throwIfAny("providers");
    }

    if (mode === "backend") {
      await startBackend(handle, explored, acquiredProviders, options.listen !== false && !options.inspect, options.inspect);
    } else if (mode === "worker") {
      // Phase 11 (worker) — every acquired provider that can serve starts
      // consuming. Consumers hold the event loop open; a worker with nothing
      // to consume is a misconfigured deployment, not a valid idle state.
      const workerReport = new BootReport();
      handle.consumers = await serveProviders(acquiredProviders, workerReport);
      // Serving changes what a provider reports (consumers now running).
      handle.providers = providerStatuses(acquiredProviders);
      workerReport.throwIfAny("workers");
      if (handle.consumers === 0) {
        throw new Error(
          "worker mode started with zero processors — no module registered queue work",
        );
      }
    }
    // "script" starts nothing: the caller owns what happens next, and owns
    // calling handle.shutdown() when it is done.

    // Phase 12 — the banner, for a process that is up and serving.
    if (mode !== "script" && options.listen !== false && !options.inspect) {
      printStartupBanner(handle, order, Date.now() - bootStartedAt);
    }

    if (options.handleSignals !== false) {
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        const handler = () => {
          console.log(`\n[tulipes] ${signal} — shutting down`);
          handle.shutdown().then(
            () => process.exit(0),
            (error) => {
              console.error("[tulipes] shutdown failed:", error);
              process.exit(1);
            },
          );
        };
        signalHandlers.set(signal, handler);
        process.once(signal, handler);
      }
    }

    return handle;
  } catch (error) {
    try {
      await handle.shutdown();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError],
        `Boot failed: ${error instanceof Error ? error.message : String(error)}; cleanup also failed`,
        { cause: error });
    }
    throw error;
  }
}

function resolveMode(override: ProcessMode | undefined): ProcessMode {
  const raw = override ?? process.env.PROCESS_MODE ?? "backend";
  if (!(processModes as readonly string[]).includes(raw)) {
    // "web" was this mode's name before 0.1.5; name the replacement rather
    // than leaving an upgrader to guess from the valid-values list.
    const hint = raw === "web" ? ' — "web" was renamed to "backend"' : "";
    throw new Error(
      `PROCESS_MODE "${raw}" is invalid — expected one of: ${processModes.join(", ")}${hint}`,
    );
  }
  return raw as ProcessMode;
}

/**
 * Phase 11 (backend): express, module routes, http server.
 *
 * The request pipeline, in order:
 *   1. every module router      (load order — sys modules first, so their
 *                                routes files mounting on ctx.app ARE the
 *                                global middleware slot: request ids and
 *                                cross-cutting glue in the core module,
 *                                headers/logging/body parsing in security)
 *   2. notFoundHandler          (core)
 *   3. errorHandler             (core — terminal, catches async throws too)
 *
 * Core deliberately mounts NO middleware of its own: what runs on every
 * request is the app's decision, expressed as sys modules within the
 * developer's reach. Core only guarantees the fail-closed tail — nothing
 * escapes unrouted or unhandled. @tulipes/core/http ships only that tail's
 * building blocks (HttpError, notFoundHandler, errorHandler).
 */
async function startBackend(
  handle: BootHandle,
  explored: readonly ModuleFiles[],
  providers: readonly AcquiredProvider[],
  listen = true,
  inspect = false,
): Promise<void> {
  const app = express();
  handle.app = app;
  handle.ctx.app = app;

  const report = new BootReport();
  // A returned router lands under the configured prefix; the app seed
  // owns that value, so every module agrees without importing anything.
  handle.ctx.routes.bind_(app, String((handle.ctx.config.api as { prefix?: unknown } | undefined)?.prefix ?? ""));
  await loadRoutes(app, explored, handle.ctx.routes, handle.ctx as BackendCtx, report);

  app.use(notFoundHandler());
  app.use(errorHandler(handle.env.appEnv));

  // Every route must have declared a RAI. Checked here, once everything is
  // mounted, so the failure is a refused boot rather than an endpoint that
  // silently answers anyone.
  handle.ctx.routes.record_(scanRoutes(app, report));

  report.throwIfAny("routes");

  // The agent surface needs the scanned routes (method and path of every
  // tool) and the ACL; it is the last thing built before the server exists.
  const agentReport = new BootReport();
  handle.ctx.agent = await loadAgents(explored, handle.ctx as RuntimeCtx, agentReport);
  agentReport.throwIfAny("agent");

  const port = handle.env.store.has("PORT")
    ? Number(handle.env.get("PORT"))
    : 3000;

  const server = createServer(app);
  handle.server = server;

  // Transports attach before listen() so no client can connect to a
  // namespace that isn't wired yet. Inspection never attaches.
  const attachReport = new BootReport();
  if (!inspect) await attachProviders(providers, server, attachReport);
  handle.providers = providerStatuses(providers);
  attachReport.throwIfAny("providers");

  if (!listen) return;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve());
  });
}

/**
 * Stop new work, drain active work, run the cleanups bootstrap returned in
 * reverse order, then dispose infrastructure. `ctx.signal` aborts first, so
 * long-lived work ends while everything it may still need is alive.
 */
async function shutdown(
  handle: BootHandle,
  aborter: AbortController,
  cleanups: readonly RegisteredCleanup[],
  providers: readonly AcquiredProvider[],
  settings: Settings,
  fileStore: FileSettingsStore | undefined,
  timeoutMs: number,
): Promise<void> {
  const cleanup = new Cleanup(timeoutMs);
  aborter.abort();
  settings.dispose();
  await Promise.all([
    cleanup.run("http", async () => {
      if (handle.server?.listening) {
        await new Promise<void>((resolve, reject) => {
          handle.server!.close(error => error ? reject(error) : resolve());
        });
      }
    }, () => handle.server?.closeAllConnections()),
    ...drainProviders(providers, cleanup),
  ]);

  for (const { module, file, cleanup: dispose } of [...cleanups].reverse()) {
    await cleanup.run(`${module} bootstrap cleanup (${file})`, () => dispose());
  }
  await disposeProviders(providers, cleanup);
  fileStore?.dispose();
  cleanup.finish();
}
