import type { Express, Router } from "express";

import type { Environment } from "../env/environment.js";
import type { GlobalConfig } from "../config/index.js";
import type { Acl } from "../acl/acl.js";
import type { ModelStore } from "../db/model-store.js";
import type { QueueManager } from "../queues/queue-manager.js";
import type { SocketManager } from "../sockets/socket-manager.js";

/**
 * The context object threaded through every module-authored function.
 * Later-phase members only exist once their phase has run: config factories
 * (phase 6) see neither `acl` (phase 7) nor `app` (backend branch, phase 9).
 */
export interface Ctx {
  Environment: Environment;
  config: GlobalConfig;
  acl?: Acl;
  models?: ModelStore;
  queues?: QueueManager;
  sockets?: SocketManager;
  app?: Express;
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
