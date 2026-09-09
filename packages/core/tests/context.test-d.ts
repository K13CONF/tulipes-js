import type { ConfigCtx, BackendCtx, ModuleConfigFn, RoutesFn } from "../src/boot/index.js";
import { requireModels, requireQueues } from "../src/boot/index.js";
import type { InspectionContext } from "../src/boot/index.js";
import { defineRoutes } from "../src/http/index.js";
import type { RequestHandler, RequestParamHandler, ErrorRequestHandler } from "express";

declare const inspection: InspectionContext;
// @ts-expect-error Offline inspection has no runtime environment or secrets.
inspection.Environment;
// @ts-expect-error Offline inspection never acquires a database.
inspection.models;
const declaration = defineRoutes(ctx => {
  // @ts-expect-error Router construction has no live environment.
  ctx.Environment;
  const callbacks = ctx.runtime(runtime => {
    // @ts-expect-error Runtime infrastructure remains optional.
    runtime.models.get("User");
    return {
      handler: ((_req, res) => { res.respond({ data: null }); }) satisfies RequestHandler,
      param: ((_req, _res, next, _id) => next()) satisfies RequestParamHandler,
      error: ((_err, _req, _res, next) => next()) satisfies ErrorRequestHandler,
    };
  });
  const handler: RequestHandler = callbacks(value => value.handler);
  const param: RequestParamHandler = callbacks(value => value.param);
  const error: ErrorRequestHandler = callbacks(value => value.error);
  // @ts-expect-error A callback must be selected, not arbitrary data.
  callbacks(() => 42);
  void handler; void param; void error;
});
void declaration;

declare const config: ConfigCtx;
// @ts-expect-error Database registration has not happened during configuration.
config.models;
// @ts-expect-error Express is created after configuration.
config.app;

declare const backend: BackendCtx;
backend.app.disable("x-powered-by");
// @ts-expect-error A backend may have no database.
backend.models.get("User");
requireModels(backend).get("User");
requireQueues(backend).queue("users.welcome");
const configFactory: ModuleConfigFn = ctx => {
  // @ts-expect-error Config factories do not receive runtime queues.
  ctx.queues;
  return { mode: ctx.mode };
};
const routes: RoutesFn = ctx => { ctx.app.disable("x-powered-by"); };
void configFactory; void routes;
