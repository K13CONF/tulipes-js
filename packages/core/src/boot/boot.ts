import { Cleanup } from "./cleanup.js";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import express, { type Express } from "express";

import { Environment, type AppEnv } from "../env/environment.js";
import { BootReport } from "../errors/boot-error.js";
import { discoverModules } from "../modules/discovery.js";
import { sortModules } from "../modules/graph.js";
import { exploreModules, type ModuleFiles } from "../modules/explorer.js";
import { buildGlobalConfig } from "../config/build-config.js";
import { loadAcl } from "../acl/load-acl.js";
import { errorHandler, notFoundHandler } from "../http/error-handler.js";
import { createRai, RouteRegistry } from "../http/rai.js";
import { bindRespond, warnOnRawResponse } from "../http/respond.js";
import { I18n } from "../i18n/i18n.js";
import { scanRoutes } from "../http/route-scan.js";
import { loadRoutes } from "./load-routes.js";
import { loadAppConfigSeed } from "./app-files.js";
import { printStartupBanner } from "./banner.js";
import {
  acquireProviders,
  attachProviders,
  checkRequirements,
  disposeProviders,
  drainProviders,
  providerStatuses,
  readProviderDeclarations,
  serveProviders,
  type AcquiredProvider,
  type AcquiredStatus,
} from "./providers.js";
import type { BackendCtx, Ctx, ModuleLifecycle } from "./contracts.js";

/**
 * "script" is a one-shot mode: it runs every shared phase — environment,
 * modules, config, ACL, database, models, queue registration — then starts
 * nothing at all, so a maintenance script gets exactly what a request
 * handler gets minus the server. It is deliberately the same code path as
 * the long-running modes, so a script can never be handed config the real
 * app does not have.
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
  /** Total graceful cleanup deadline, including hooks. Defaults to 10 seconds. */
  shutdownTimeoutMs?: number;
  /** Mount routes for tooling; skip bootstrap, sockets, listening and readiness. */
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
 * The whole run workflow, in the order the POC pins down:
 * environment → module graph → exploration → global config → (acl, db —
 * future steps) → mode fork (backend | worker) → onReady. Each phase crashes
 * with its aggregate report before the next begins.
 */
export async function boot(options: BootOptions): Promise<BootHandle> {
  const bootStartedAt = Date.now();
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 10_000;
  if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    throw new Error("shutdownTimeoutMs must be a positive finite number");
  }
  const mode = resolveMode(options.mode);
  if (options.inspect && mode !== "backend") throw new Error("inspection requires backend mode");

  // Phases 1–3 — Environment engine (crashes internally on bad env)
  const env = Environment.load({
    rootDir: options.rootDir,
    ...(options.appEnv && { appEnv: options.appEnv }),
  });

  // Phase 4 — module graph
  const graphReport = new BootReport();
  const manifests = discoverModules(join(options.rootDir, "modules"), graphReport);
  const order = sortModules(manifests, graphReport);
  graphReport.throwIfAny("module graph");

  // Phase 5 — exploration (no failure modes)
  const explored = exploreModules(order);

  // Phase 5b — provider declarations. Static, read from the app's own
  // package.json, checked against every module's requirements BEFORE any
  // module code is imported: a module that needs models in an app with no
  // models provider never gets as far as importing a schema.
  const providerReport = new BootReport();
  const declaredProviders = readProviderDeclarations(options.rootDir, providerReport);
  checkRequirements(explored, declaredProviders, providerReport);
  providerReport.throwIfAny("providers");

  // Phase 6 — global config: app-level seed first, then module factories
  // The registry exists before any module runs, so a routes file can
  // declare into it the moment it is called.
  const routes = new RouteRegistry();
  // The i18next instance exists from here on and is never replaced, so
  // ctx.i18n and ctx.t are safe to hold from any phase; phase 6b is where
  // the resources arrive.
  const i18n = new I18n();
  const ctx: Ctx = {
    mode,
    Environment: env,
    modules: order,
    config: {},
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
  let lifecycles: ModuleLifecycle[] = [];
  let shutdownPromise: Promise<void> | undefined;
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  // Per boot, never module-global: two handles in one process own two sets.
  const acquiredProviders: AcquiredProvider[] = [];
  const handle: BootHandle = {
    mode, env, ctx, i18n,
    providers: [],
    consumers: 0,
    shutdown: () => {
      if (!shutdownPromise) {
        for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
        shutdownPromise = shutdown(handle, lifecycles, acquiredProviders, shutdownTimeoutMs);
      }
      return shutdownPromise;
    },
  };
  try {
    const configReport = new BootReport();
    await loadAppConfigSeed(options.rootDir, ctx, configReport);
    lifecycles = await buildGlobalConfig(explored, ctx, configReport);
    configReport.throwIfAny("config");

    // Phase 6b — translations. After config, because the locales an app ships
    // are app policy read from config.i18n; before everything that might want
    // to say something to a user.
    const i18nReport = new BootReport();
    await i18n.load(
      explored,
      I18n.readSettings(ctx.config.i18n, i18nReport),
      env.appEnv,
      i18nReport,
    );
    i18nReport.throwIfAny("i18n");

    // Phase 7 — ACL merge
    const aclReport = new BootReport();
    ctx.acl = await loadAcl(explored, aclReport);
    aclReport.throwIfAny("acl");

    // Phase 8 — declared providers, in capability order (models, queues). A provider registers
    // ownership through own() before it awaits anything, so the failure path
    // below can always dispose what was created. Only the app's declaration
    // selects a provider: an installed package or a MONGO_URI on its own
    // acquires nothing.
    const acquireReport = new BootReport();
    acquiredProviders.push(...await acquireProviders(declaredProviders, {
      ctx, rootDir: options.rootDir, files: explored,
      situation: options.inspect ? "inspect" : mode,
      runBootstrap: mode !== "script" && !options.inspect,
    }, acquireReport));
    handle.providers = providerStatuses(acquiredProviders);
    acquireReport.throwIfAny("providers");

    if (mode === "backend") {
      await startBackend(handle, explored, acquiredProviders, options.listen !== false && !options.inspect, options.inspect);
    } else if (mode === "worker") {
      // Phase 9 (worker) — every acquired provider that can serve starts
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

    // Phase 12 — onReady, load order. Scripts skip it: those hooks announce a
    // process that is up and serving, which a script never is.
    if (mode !== "script" && options.listen !== false && !options.inspect) {
      for (const { module, onReady } of lifecycles) {
        try {
          await onReady?.(ctx);
        } catch (error) {
          // Late-phase hook failures must still take the process down cleanly:
          // a half-ready app serving traffic is worse than no app.
          throw new Error(`onReady hook of "${module}" failed: ${(error as Error).message}`, { cause: error });
        }
      }

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
 * Phases 9b–11b: express, module routes, http server.
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
  if (explored.every(files => files.module.offline) && handle.ctx.routes.checker) {
    report.add({ scope: "routes", message: "offline modules must install custom access checkers inside defineRoutes, not runtime config" });
  }
  await loadRoutes(app, explored, handle.ctx.routes, handle.ctx.rai, report, handle.ctx as BackendCtx);

  app.use(notFoundHandler());
  app.use(errorHandler(handle.env.appEnv));

  // Every route must have declared a RAI. Checked here, once everything is
  // mounted, so the failure is a refused boot rather than an endpoint that
  // silently answers anyone.
  handle.ctx.routes.record_(scanRoutes(app, report));

  report.throwIfAny("routes");

  const port = handle.env.store.has("PORT")
    ? Number(handle.env.get("PORT"))
    : 3000;

  const server = createServer(app);
  handle.server = server;

  // Phase 11b — transports attach before listen() so no client can connect
  // to a namespace that isn't wired yet. Inspection never attaches.
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

/** Stop new work, drain active work, dispose modules, then infrastructure. */
async function shutdown(
  handle: BootHandle,
  lifecycles: readonly ModuleLifecycle[],
  providers: readonly AcquiredProvider[],
  timeoutMs: number,
): Promise<void> {
  const cleanup = new Cleanup(timeoutMs);
  // Begin notification before waiting for traffic. Hooks share the drain's
  // deadline, so a stuck notifier cannot prevent HTTP/workers from stopping.
  const notifications = [...lifecycles].reverse().map(({ module, onDrain }) =>
    cleanup.run(`${module} onDrain`, () => onDrain?.(handle.ctx)),
  );
  await Promise.all([
    ...notifications,
    cleanup.run("http", async () => {
      if (handle.server?.listening) {
        await new Promise<void>((resolve, reject) => {
          handle.server!.close(error => error ? reject(error) : resolve());
        });
      }
    }, () => handle.server?.closeAllConnections()),
    ...drainProviders(providers, cleanup),
  ]);

  for (const { module, onShutdown } of [...lifecycles].reverse()) {
    await cleanup.run(`${module} onShutdown`, () => onShutdown?.(handle.ctx));
  }
  await disposeProviders(providers, cleanup);
  cleanup.finish();
}
