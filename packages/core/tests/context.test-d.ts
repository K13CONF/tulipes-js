import type {
  BackendCtx,
  RoutesFn,
  BootstrapFn,
} from "../src/boot/index.ts";
import { requireModels, requireQueues } from "../src/boot/index.ts";
import { Router } from "express";
import { defineConfig } from "../src/config/index.ts";
import { z } from "zod/v4";
import type {
  RequestHandler,
  RequestParamHandler,
  ErrorRequestHandler,
} from "express";

declare const backend: BackendCtx;

// A routes file is a plain function of the backend context: it mounts on
// the app, returns a router for the configured prefix, or mounts explicitly.
const mounted: RoutesFn = (ctx) => {
  ctx.routes.mount(Router(), "/ops");
  ctx.routes.mount(Router(), "/tenants/:tenant", Router());
  return Router();
};

const middleware: RoutesFn = ({ app }) => {
  app.use((_req, _res, next) => next());
};

void mounted;
void middleware;

backend.app.disable("x-powered-by");

// @ts-expect-error A backend may have no database.
backend.models.get("User");

// Members of ModelsCapability come from a provider's declarations; this test
// program includes @tulipes/mongoose's, so `get` exists here. The packed
// core-only fixture is what proves a core-only app cannot call it.
requireModels(backend).get("User");

requireQueues(backend).queue("users.welcome");

// The agent surface exists in the backend branch only, typed from the registry.
void backend.agent.manifest("admin").tools[0]?.input_schema;
void backend.agent.invoke("hello_reset-counts", { confirm: true }, { isAuthenticated: true, user: null, session: null, role: "admin" });
declare const script: import("../src/boot/index.ts").Ctx;
// @ts-expect-error A worker or script context may carry no agent registry.
script.agent.manifest();

const routes: RoutesFn = (ctx) => {
  ctx.app.disable("x-powered-by");
};

const bootstrap: BootstrapFn = (ctx) => {
  void ctx.acl.can("guest", "probe:read");
  void ctx.settings.namespaces();
  ctx.signal.addEventListener("abort", () => undefined);
  // @ts-expect-error Bootstrap runs before Express exists.
  ctx.app.disable("x-powered-by");
  return () => undefined;
};

const settingsDeclaration = defineConfig({
  schema: z.object({ limit: z.number().default(5) }),
  onChange(next, ctx) {
    const limit: number = next.limit;
    // @ts-expect-error The declared shape is exact.
    next.other;
    void limit;
    void ctx.mode;
  },
});

void routes;
void bootstrap;
void settingsDeclaration;
