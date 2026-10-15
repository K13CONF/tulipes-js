import type {
  BackendCtx,
  RoutesFn,
  BootstrapFn,
} from "../src/boot/index.ts";
import { requireModels, requireQueues } from "../src/boot/index.ts";
import { Router } from "express";
import { defineConfig } from "../src/config/index.ts";
import type { AclBuilder } from "../src/acl/index.ts";
import { parseRai } from "../src/acl/index.ts";
import { action } from "../src/agent/define-agent.ts";
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

// The agent surface is on every runtime context, typed from the registry.
void backend.agent.manifest("admin").tools[0]?.input_schema;
void backend.agent.invoke("hello_reset-counts", { confirm: true }, { isAuthenticated: true, user: null, session: null, role: "admin" });
// A credential's scopes ride on the actor; the manifest filters by role or by actor.
const scoped = { isAuthenticated: true, user: null, session: null, role: "admin", scopes: ["hello:web:*"] } as const;
void backend.agent.manifest(scoped);
void backend.agent.invoke("hello_web_greetings", {}, scoped);
// @ts-expect-error Scopes are grant patterns, a list of strings.
void backend.agent.manifest({ isAuthenticated: true, user: null, session: null, role: "admin", scopes: "hello:web:*" });
declare const worker: import("../src/boot/index.ts").RuntimeCtx;
void worker.agent.manifest();
declare const early: import("../src/boot/index.ts").Ctx;
// @ts-expect-error Before phase 8 the registry does not exist yet.
early.agent.manifest();

const routes: RoutesFn = (ctx) => {
  ctx.app.disable("x-powered-by");
};

const bootstrap: BootstrapFn = (ctx) => {
  void ctx.acl.can("guest", "probe:web:read");
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

// A RAI id is "module:scope:resource[:extra]". Leaving the scope out is
// caught in the editor; the boot scan is the authority on the rest.
backend.rai({ id: "users:bo:list" });
backend.rai({ id: "users:bo:detail:delete" });
// @ts-expect-error Two segments: the scope is missing.
backend.rai({ id: "users:read" });
action({ id: "hello:bo:greetings:reset", description: "Reset", handler: () => 0 });
// @ts-expect-error An action's id is a RAI too.
action({ id: "hello:reset", description: "Reset", handler: () => 0 });

const { scope, extra } = parseRai("users:bo:detail:delete");
const scopeIs: string = scope;
const extraIs: string | undefined = extra;
void scopeIs;
void extraIs;

// Role extras are typed by augmentation, and stay open otherwise.
declare module "../src/acl/acl.ts" {
  interface RoleMeta {
    level?: number;
  }
}
declare const roles: AclBuilder;
roles.defineRole("admin", { description: "Runs the back office", level: 2, dashboard: "bo" });
// @ts-expect-error A declared extra keeps its type.
roles.defineRole("user", { level: "high" });
// @ts-expect-error The description is a string.
roles.defineRole("guest", { description: 1 });
const level: number | undefined = backend.acl.role("admin")?.level;
const definedBy: string | undefined = backend.acl.role("admin")?.definedBy;
void level;
void definedBy;
