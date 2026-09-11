import type { Express, Router } from "express";
import type { BackendCtx } from "../boot/contracts.js";

type Callback = (...args: never[]) => unknown;

/** Select a callback without constructing its owner during offline inspection. */
export interface RuntimeBinder<T> {
  <F extends Callback>(select: (dependency: T) => F): F;
}

export interface RouterCtx {
  app: Express;
  rai: BackendCtx["rai"];
  routes: Pick<BackendCtx["routes"], "mount" | "setAccessChecker">;
  /** Acquire once per route-file build, before serving; skipped offline. */
  runtime<T>(acquire: (ctx: BackendCtx) => T | Promise<T>): RuntimeBinder<T>;
}

export type RouterFactory = (ctx: RouterCtx) => Router | void | Promise<Router | void>;
const ROUTER_FACTORY = Symbol.for("tulipes.router-factory");
export type DefinedRoutes = RouterFactory & { readonly [ROUTER_FACTORY]: true };

/** Keep native Express composition while separating runtime acquisition. */
export function defineRoutes(build: RouterFactory): DefinedRoutes {
  return Object.assign(build, { [ROUTER_FACTORY]: true as const });
}

/** @internal Recognizes factories across CLI/app copies of core. */
export function isDefinedRoutes(value: unknown): value is DefinedRoutes {
  return typeof value === "function" && Reflect.get(value, ROUTER_FACTORY) === true;
}

/** @internal Bind before listening. Inspection builds real routers but no callbacks run. */
export function runtimeBindings(): {
  runtime: RouterCtx["runtime"];
  initialize(ctx: BackendCtx): Promise<void>;
} {
  const initializers: ((ctx: BackendCtx) => Promise<void>)[] = [];
  let building = true;
  return {
    runtime<T>(acquire: (ctx: BackendCtx) => T | Promise<T>): RuntimeBinder<T> {
      if (!building) throw new Error("runtime() must be registered while building routes");
      const bindings: ((dependency: T) => void)[] = [];
      initializers.push(async ctx => {
        if (!bindings.length) return;
        const dependency = await acquire(ctx);
        for (const bind of bindings) bind(dependency);
      });
      return <F extends Callback>(select: (dependency: T) => F): F => {
        if (!building) throw new Error("runtime callbacks must be bound while building routes");
        let callback: F | undefined;
        const wrapper = function (this: unknown, ...args: unknown[]): unknown {
          if (!callback) throw new Error("Offline route callbacks cannot handle requests");
          return Reflect.apply(callback, this, args);
        };
        bindings.push(dependency => {
          callback = select(dependency);
          if (typeof callback !== "function") throw new Error("runtime binding must select a callback");
          // Express distinguishes request and error handlers by arity at dispatch.
          Object.defineProperty(wrapper, "length", { value: callback.length });
        });
        return wrapper as unknown as F;
      };
    },
    async initialize(ctx) {
      building = false;
      for (const initialize of initializers) await initialize(ctx);
    },
  };
}
