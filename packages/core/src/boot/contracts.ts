import type { Express, RequestHandler, Router } from "express";

import type { Environment } from "../env/environment.js";
import type { ProcessMode } from "./boot.js";
import type { GlobalConfig } from "../config/index.js";
import type { Acl } from "../acl/acl.js";
import type { RouteInfo, RouteRegistry } from "../http/rai.js";
import type { ModuleManifest } from "../modules/manifest.js";
import type { I18nextInstance, TFunction } from "../i18n/index.js";
import type { ModelStore } from "../db/model-store.js";
import type { QueueManager } from "../queues/queue-manager.js";
import type { SocketManager } from "../sockets/socket-manager.js";

/**
 * The context object threaded through every module-authored function.
 * Later-phase members only exist once their phase has run: config factories
 * (phase 6) see neither `acl` (phase 7) nor `app` (backend branch, phase 9).
 */
export interface Ctx {
  /**
   * Which process this is. Modules that must behave differently per
   * process read it here — a logger naming its file per mode, so backend
   * and worker never rotate the same file, is the motivating case.
   */
  mode: ProcessMode;
  Environment: Environment;
  /**
   * Every module in load order, with its manifest and resolved directory.
   *
   * The authoritative answer to "what modules does this app have?" —
   * `config` cannot answer it, because the app-level seed puts keys there
   * that belong to no module.
   */
  modules: readonly ModuleManifest[];
  config: GlobalConfig;
  acl?: Acl;
  models?: ModelStore;
  queues?: QueueManager;
  sockets?: SocketManager;
  app?: Express;
  /**
   * Declares an endpoint and gates it. `id` is the Resource Access
   * Identifier, which is also the ACL permission:
   *
   *   router.get(path, rai({ id: "users:read" }), handler);
   *
   * A route without one aborts the boot — see the route scan.
   */
  rai: (info: RouteInfo) => RequestHandler;
  /** Every declared endpoint, filled once routes are mounted. */
  routes: RouteRegistry;
  /**
   * A translator bound to one module's namespace, for code with no request
   * to negotiate a locale from — queue processors, scripts, bootstrap:
   *
   *   const t = ctx.t("users", recipient.locale);
   *
   * Inside a request handler use `req.t`, which is bound already.
   */
  t: (namespace: string, locale?: string) => TFunction;
  /** The i18next instance, for anything `ctx.t` does not cover. */
  i18n: I18nextInstance;
}

/**
 * Default export of `module.config.ts`. Returns the module's config
 * namespace (stored at `config.<module>`); returning nothing is a valid
 * "this module has no config" answer.
 *
 * Factories run in load order against the growing global config, so a
 * module can read the namespaces of everything it `dependsOn`.
 */
export type ModuleConfigFn = (
  ctx: Ctx,
) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;

export type LifecycleHook = (ctx: Ctx) => void | Promise<void>;

/**
 * Optional named exports of `module.config.ts`:
 *   onReady    — after the process is fully up (server listening / worker consuming)
 *   onShutdown — graceful shutdown, invoked in REVERSE load order
 */
export interface ModuleLifecycle {
  module: string;
  onReady?: LifecycleHook;
  onShutdown?: LifecycleHook;
}

/**
 * Default export of `routes/*.routes.ts` (backend branch only). May mount
 * directly on `ctx.app`, or return a Router for core to `app.use()` —
 * returning one is the recommended style.
 */
export type RoutesFn = (ctx: Ctx) => Router | void | Promise<Router | void>;
