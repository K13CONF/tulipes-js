import type {
  BackendCtx,
  RoutesFn,
  BootstrapFn,
} from "../src/boot/index.js";
import { requireModels, requireQueues } from "../src/boot/index.js";
import type { InspectionContext } from "../src/boot/index.js";
import { defineRoutes } from "../src/http/index.js";
import { defineConfig } from "../src/config/index.js";
import { z } from "zod/v4";
import type {
  RequestHandler,
  RequestParamHandler,
  ErrorRequestHandler,
} from "express";

declare const inspection: InspectionContext;

// @ts-expect-error Offline inspection has no runtime environment or secrets.
inspection.Environment;

// @ts-expect-error Offline inspection never acquires a database.
inspection.models;

const declaration = defineRoutes((ctx) => {
  // @ts-expect-error Router construction has no live environment.
  ctx.Environment;

  const callbacks = ctx.runtime((runtime) => {
    // @ts-expect-error Runtime infrastructure remains optional.
    runtime.models.get("User");

    return {
      handler: ((_req, res) => {
        res.respond({ data: null });
      }) satisfies RequestHandler,
      param: ((_req, _res, next, _id) => next()) satisfies RequestParamHandler,
      error: ((_err, _req, _res, next) => next()) satisfies ErrorRequestHandler,
    };
  });

  const handler: RequestHandler = callbacks((value) => value.handler);
  const param: RequestParamHandler = callbacks((value) => value.param);
  const error: ErrorRequestHandler = callbacks((value) => value.error);

  // @ts-expect-error A callback must be selected, not arbitrary data.
  callbacks(() => 42);

  void handler;
  void param;
  void error;
});

void declaration;

declare const backend: BackendCtx;

backend.app.disable("x-powered-by");

// @ts-expect-error A backend may have no database.
backend.models.get("User");

// Members of ModelsCapability come from a provider's declarations; this test
// program includes @tulipes/mongoose's, so `get` exists here. The packed
// core-only fixture is what proves a core-only app cannot call it.
requireModels(backend).get("User");

requireQueues(backend).queue("users.welcome");

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
