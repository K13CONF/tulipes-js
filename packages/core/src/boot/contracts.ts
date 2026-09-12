import type { Express, RequestHandler, Router } from "express";

import type { Environment } from "../env/environment.js";
import type { ProcessMode } from "./boot.js";
import type { GlobalConfig } from "../config/index.js";
import type { Acl } from "../acl/acl.js";
import type { RouteInfo, RouteRegistry } from "../http/rai.js";
import type { ModuleManifest } from "../modules/manifest.js";
import type { I18nextInstance, TFunction } from "../i18n/index.js";

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
  /**
   * Set by the "models" provider the app declares in package.json
   * (`tulipes.providers.models`). Core knows only that the slot exists; the
   * provider's declarations augment ModelsCapability with the real methods.
   */
  models?: ModelsCapability;
  /** Set by the "queues" provider (`tulipes.providers.queues`); augmented like models. */
  queues?: QueuesCapability;
  /** Set by the "sockets" provider in the backend process only; augmented like models. */
  sockets?: SocketsCapability;
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
  ctx: ConfigCtx,
) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;

export type LifecycleHook = (ctx: Ctx) => void | Promise<void>;

/**
 * Optional named exports of `module.config.ts`:
 *   onReady    — after the process is fully up (server listening / worker consuming)
 *   onDrain    — stop long-lived work at the start of shutdown; do not dispose dependencies
 *   onShutdown — dispose resources after traffic drains, in REVERSE load order
 * Drain hooks start in reverse load order, concurrently with traffic draining.
 * Both shutdown phases share the same deadline and aggregate failures.
 */
export interface ModuleLifecycle {
  module: string;
  onReady?: LifecycleHook;
  onDrain?: LifecycleHook;
  onShutdown?: LifecycleHook;
}

/**
 * Default export of `routes/*.routes.ts` (backend branch only). May mount
 * directly on `ctx.app`, or return a Router for core to `app.use()` —
 * returning one is the recommended style.
 */
export type RoutesFn = (ctx: BackendCtx) => Router | void | Promise<Router | void>;

/** Configuration runs before ACL, database, queues or Express exist. */
export type ConfigCtx = Pick<Ctx,
  "mode" | "Environment" | "modules" | "config" | "rai" | "routes" | "t" | "i18n"
>;

/** Runtime infrastructure is optional, even after its initialization phase. */
export interface RuntimeCtx extends Ctx {
  acl: Acl;
}

/** Context passed to route factories in the backend branch. */
export interface BackendCtx extends RuntimeCtx {
  mode: "backend";
  app: Express;
}

/**
 * What `ctx.models` is. Empty here on purpose: a provider package augments
 * this interface (the same way apps augment GlobalConfig), so an app that
 * compiles the provider sees typed model access and a core-only app sees
 * nothing to call. Selection stays a runtime fact — see requireModels.
 */
export interface ModelsCapability {}

/** Same shape for background work: empty here, augmented by the queues provider. */
export interface QueuesCapability {}

/** Realtime transport: empty here, augmented by the sockets provider. */
export interface SocketsCapability {}

/** Capability name → the value a provider hands to ctx. */
export interface ProviderCapabilities {
  models: ModelsCapability;
  queues: QueuesCapability;
  sockets: SocketsCapability;
}

/** Bootstrap tasks only run with a registered model store. */
export interface DatabaseCtx extends RuntimeCtx {
  models: ModelsCapability;
}

/** Explicit capability checks for applications that require infrastructure. */
export function requireModels(ctx: Pick<Ctx, "models">): ModelsCapability {
  if (!ctx.models) {
    throw new Error(
      'This module requires a database model store — no "models" provider is declared in package.json ("tulipes.providers.models")',
    );
  }
  return ctx.models;
}

export function requireQueues(ctx: Pick<Ctx, "queues">): QueuesCapability {
  if (!ctx.queues) {
    throw new Error(
      'This module requires a queue manager — no "queues" provider is declared in package.json ("tulipes.providers.queues")',
    );
  }
  return ctx.queues;
}
