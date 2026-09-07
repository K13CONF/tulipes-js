import type { ConfigCtx, BackendCtx, ModuleConfigFn, RoutesFn } from "../src/boot/index.js";
import { requireModels, requireQueues } from "../src/boot/index.js";

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
