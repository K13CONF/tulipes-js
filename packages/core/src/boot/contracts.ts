import type { Express, RequestHandler, Router } from "express";

import type { AppEnv } from "./app-env.ts";
import type { ProcessMode } from "./boot.ts";
import type { GlobalConfig } from "../config/index.ts";
import type { SettingsApi } from "../config/settings.ts";
import type { Acl } from "../acl/acl.ts";
import type { AgentRegistry } from "../agent/registry.ts";
import type { RouteInfo, RouteRegistry } from "../http/rai.ts";
import type { ModuleManifest } from "../modules/manifest.ts";
import type { I18nextInstance, TFunction } from "../i18n/index.ts";
import type { ZonedTime } from "../time/index.ts";

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
  /**
   * Which deployment this is — development, staging, production or test —
   * from APP_ENV. It selects the env file and the settings file at boot;
   * modules read it to refuse a development default in production, or to
   * record where an action happened.
   */
  appEnv: AppEnv;
  /**
   * Every module in load order, with its manifest and resolved directory.
   *
   * The authoritative answer to "what modules does this app have?" —
   * `config` cannot answer it, because the app-level seed puts keys there
   * that belong to no module.
   */
  modules: readonly ModuleManifest[];
  /**
   * Every module's configuration, namespaced by short name: its settings,
   * kept live (a write through `ctx.settings` or from another replica
   * replaces the values in place), and its environment values, read-only
   * and bound at boot from the variables its package.json declares. Read a
   * value where it is used, never cache it at boot.
   */
  config: GlobalConfig;
  /** The write and inspection side of the settings store; reads go through `config`. */
  settings: SettingsApi;
  /**
   * Aborted the moment shutdown begins, before HTTP stops accepting. An SSE
   * handler ends its response on it; a poller stops its loop. Resources
   * are closed later, by the cleanup a bootstrap returned.
   */
  signal: AbortSignal;
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
   * Every action the modules declare in `agent/*.agent.ts`, built once the
   * ACL exists, in every mode: the manifest an in-app agent hands a model,
   * and `invoke()` for each tool call. Present from phase 8 on.
   */
  agent?: AgentRegistry;
  /**
   * Declares an endpoint and gates it. `id` is the Resource Access
   * Identifier, which is also the ACL permission:
   *
   *   router.get(path, rai({ id: "users:bo:list" }), handler);
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
  /**
   * Zone-aware helpers for code with no request to negotiate a zone from —
   * a nightly report, a reminder email. `ctx.time.zone` is
   * `config.timezone.default` (UTC when the app names none); pass the
   * recipient's zone to read an instant as they would:
   *
   *   ctx.time.in(user.timezone, user.locale).format(invoice.due_at);
   *
   * Inside a request handler use `req.time`, already bound to the caller's
   * zone. Settled in phase 7, with translations.
   */
  time: ZonedTime & { in(zone?: string, locale?: string): ZonedTime };
}

/**
 * What a bootstrap returns when it opened something: the function that
 * closes it. Core runs cleanups after traffic drains, in reverse load
 * order, under the shutdown deadline.
 */
export type BootstrapCleanup = () => void | Promise<void>;

/**
 * Default export of `bootstrap/*.bootstrap.ts` — phase 9, every mode, after
 * settings, translations and ACL and before routes or queues. The one place
 * a module initializes: seeds and indexes (idempotent, every process runs
 * them), or a client it keeps open, whose cleanup it returns.
 */
export type BootstrapFn = (ctx: RuntimeCtx) => void | BootstrapCleanup | Promise<void | BootstrapCleanup>;

/**
 * Default export of `routes/*.routes.ts`. Returns a Router, which core
 * mounts under `config.api.prefix` (or `ctx.routes.mount(router, "/other")`
 * to choose the path), or mounts global middleware on `ctx.app` itself and
 * returns nothing. Build the router from the context; read `ctx.models`
 * and `ctx.config` inside handlers, where they are live — inspection runs
 * this function with stubs that throw on infrastructure, and an
 * environment value read while building throws for the same reason.
 */
export type RoutesFn = (ctx: BackendCtx) => Router | void | Promise<Router | void>;

/** Runtime infrastructure is optional, even after its initialization phase. */
export interface RuntimeCtx extends Ctx {
  acl: Acl;
  agent: AgentRegistry;
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

/** A bootstrap in a module that owns models may assert the capability is there. */
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
