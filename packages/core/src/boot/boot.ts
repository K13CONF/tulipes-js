import { createServer, type Server } from "node:http";
import type { Connection } from "mongoose";
import { join } from "node:path";
import express, { type Express } from "express";

import { Environment, type AppEnv } from "../env/environment.js";
import { BootReport } from "../errors/boot-error.js";
import { discoverModules } from "../modules/discovery.js";
import { sortModules } from "../modules/graph.js";
import { exploreModules, type ModuleFiles } from "../modules/explorer.js";
import { buildGlobalConfig } from "../config/build-config.js";
import { loadAcl } from "../acl/load-acl.js";
import { initDatabase } from "../db/database.js";
import { initQueues } from "../queues/load-queues.js";
import { initSockets } from "../sockets/load-sockets.js";
import { errorHandler, notFoundHandler } from "../http/error-handler.js";
import { loadAppConfigSeed } from "./app-files.js";
import { printStartupBanner } from "./banner.js";
import { importFile } from "./import-file.js";
import type { Ctx, ModuleLifecycle, RoutesFn } from "./contracts.js";

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
}

export interface BootHandle {
  mode: ProcessMode;
  env: Environment;
  ctx: Ctx;
  connection?: Connection;
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
  const mode = resolveMode(options.mode);

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

  // Phase 6 — global config: app-level seed first, then module factories
  const ctx: Ctx = { mode, Environment: env, config: {} };
  const configReport = new BootReport();
  await loadAppConfigSeed(options.rootDir, ctx, configReport);
  const lifecycles = await buildGlobalConfig(explored, ctx, configReport);
  configReport.throwIfAny("config");

  // Phase 7 — ACL merge
  const aclReport = new BootReport();
  ctx.acl = await loadAcl(explored, aclReport);
  aclReport.throwIfAny("acl");

  // Phase 8 — DB + models + bootstrap
  const dbReport = new BootReport();
  const connection = await initDatabase(explored, ctx, dbReport, {
    runBootstrap: mode !== "script",
  });
  dbReport.throwIfAny("database");

  // Phase 9 — mode fork
  const handle: BootHandle = {
    mode,
    env,
    ctx,
    connection,
    shutdown: () => shutdown(handle, lifecycles),
  };

  // Phase 9 — queues register in both modes (producers everywhere; the
  // worker branch additionally starts consuming below).
  const queueReport = new BootReport();
  await initQueues(explored, ctx, queueReport);
  queueReport.throwIfAny("queues");

  if (mode === "backend") {
    await startBackend(handle, explored);
  } else if (mode === "worker") {
    const workerReport = new BootReport();
    const started = ctx.queues?.startWorkers(workerReport) ?? 0;
    workerReport.throwIfAny("workers");
    // BullMQ workers hold the event loop open; a worker with nothing to
    // consume is a misconfigured deployment, not a valid idle state.
    if (started === 0) {
      throw new Error(
        "worker mode started with zero processors — no module registered queue work",
      );
    }
  }
  // "script" starts nothing: the caller owns what happens next, and owns
  // calling handle.shutdown() when it is done.

  // Phase 12 — onReady, load order. Scripts skip it: those hooks announce a
  // process that is up and serving, which a script never is.
  if (mode !== "script") {
    for (const { module, onReady } of lifecycles) {
      try {
        await onReady?.(ctx);
      } catch (error) {
        // Late-phase hook failures must still take the process down cleanly:
        // a half-ready app serving traffic is worse than no app.
        await handle.shutdown();
        throw new Error(`onReady hook of "${module}" failed: ${(error as Error).message}`);
      }
    }

    printStartupBanner(handle, order, Date.now() - bootStartedAt);
  }

  if (options.handleSignals !== false) {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        console.log(`\n[tulipes] ${signal} — shutting down`);
        handle.shutdown().then(
          () => process.exit(0),
          (error) => {
            console.error("[tulipes] shutdown failed:", error);
            process.exit(1);
          },
        );
      });
    }
  }

  return handle;
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
): Promise<void> {
  const app = express();
  handle.app = app;
  handle.ctx.app = app;

  const report = new BootReport();
  for (const { module, routeFiles } of explored) {
    for (const file of routeFiles) {
      const exported = await importFile<{ default?: unknown }>(
        file, "boot", module.name, report,
      );
      if (!exported) continue;
      if (typeof exported.default !== "function") {
        report.add({
          scope: "boot",
          module: module.name,
          message: `${file} must default-export a routes function`,
        });
        continue;
      }
      try {
        const router = await (exported.default as RoutesFn)(handle.ctx);
        // Mounting the return value is optional sugar — a routes fn may
        // have attached handlers to ctx.app directly instead. Routers are
        // callables in express, so a function return is a mountable.
        if (typeof router === "function") app.use(router);
      } catch (error) {
        report.add({
          scope: "boot",
          module: module.name,
          message: `routes function threw: ${(error as Error).message}`,
        });
      }
    }
  }

  app.use(notFoundHandler());
  app.use(errorHandler(handle.env.appEnv));

  report.throwIfAny("routes");

  const port = handle.env.store.has("PORT")
    ? Number(handle.env.get("PORT"))
    : 3000;

  const server = createServer(app);
  handle.server = server;

  // Phase 11b — sockets attach before listen() so no client can connect
  // to a namespace that isn't wired yet.
  const socketReport = new BootReport();
  await initSockets(explored, handle.ctx, server, socketReport);
  socketReport.throwIfAny("sockets");

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve());
  });
}

/** Reverse load order, every hook attempted even if an earlier one throws. */
async function shutdown(
  handle: BootHandle,
  lifecycles: readonly ModuleLifecycle[],
): Promise<void> {
  const failures: string[] = [];

  for (const { module, onShutdown } of [...lifecycles].reverse()) {
    try {
      await onShutdown?.(handle.ctx);
    } catch (error) {
      failures.push(`${module}: ${(error as Error).message}`);
    }
  }

  // Kick socket clients first so the http server's close() isn't held open
  // by long-lived websocket connections.
  handle.ctx.sockets?.close();

  if (handle.server?.listening) {
    await new Promise<void>((resolve, reject) => {
      handle.server!.close((error) => (error ? reject(error) : resolve()));
    });
  }

  // Queues drain after http stops (no new producers), workers finish their
  // in-flight jobs inside close(). DB goes down last — hooks, requests and
  // jobs may all need it right up to this point.
  await handle.ctx.queues?.close();
  await handle.connection?.close();

  if (failures.length > 0) {
    throw new Error(`onShutdown hook(s) failed — ${failures.join("; ")}`);
  }
}
