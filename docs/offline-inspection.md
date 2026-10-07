# Offline inspection with native Express routers

Routes live in `routes/*.routes.ts` and use real Express routers. Shared prefixes,
`router.use()`, `router.param()`, chained route methods, nested routers and error
middleware keep their Express behavior. `defineRoutes()` separates constructing
that router structure from acquiring runtime dependencies.

Both starter presets use offline inspection in `yarn spec`:

```sh
tulipes routes --offline
tulipes spec --offline --openapi docs/openapi.json --postman docs/collection.json
tulipes spec --offline --openapi docs/openapi.json --url https://api.example.com
```

## One router factory for runtime and tooling

Opt a module into offline inspection with `"offline": true` inside its package.json
`tulipes` object. Wrap each route file's default export with `defineRoutes()`.
A module without route files needs no empty declaration file.

```ts
// modules/users/routes/users.routes.ts
import { Router } from "express";
import { defineRoutes } from "@tulipes/core/http";

export default defineRoutes(({ app, rai, routes, runtime }) => {
  const router = Router();
  const users = runtime(async ctx => {
    const { UsersController } = await import("../controllers/users.controllers.js");
    return new UsersController(ctx);
  });

  router.get("/", rai({ id: "users:read" }), users(value => value.list()));
  router.post("/", rai({ id: "users:create", status: 201 }), users(value => value.create()));
  routes.mount(app, "/users", router);
});
```

`runtime(acquire)` returns a typed callback binder. Core calls `acquire` once per
route-file build, then resolves every bound callback before listening. Offline
inspection calls neither the acquisition function nor its callback selectors.
No placeholder controller, database, environment or queue is supplied.

The binder works for request middleware, parameter callbacks, error handlers and
access checkers. It forwards arguments, return values and `this`, and preserves
the acquired callback's arity so Express can distinguish error middleware:

```ts
router.use(users(value => value.requireSession()));
router.param("userId", users(value => value.loadUser()));
router.get("/:userId", rai({ id: "users:read-one" }), users(value => value.show()));
router.use(users(value => value.handleError()));
```

These illustrate application controller methods returning the corresponding
Express callbacks. Put shared middleware before its endpoints and error middleware
after them. Pure callbacks can be registered directly without `runtime()`.
Register bindings while building routes, not from a request callback. Controller
methods should return handlers with their instance state captured or bound.

`router.param()` executes before the endpoint's `rai()` middleware. Identity
resolution and authorization-sensitive parameter loading must account for that
ordering. Use middleware after `rai()` for work requiring endpoint permission.
The framework's RAI guarantee covers endpoint handler chains; router middleware
and parameter callbacks remain trusted application code.

## Prefixes and composition

Use `routes.mount(parent, prefix, childRouter)` to retain mount paths for the
shared route scan. Prefixes support literal segments and named `:parameters`.
For a child that reads parent parameters, construct it with
`Router({ mergeParams: true })`. Parameter callbacks belong to the router declaring
the corresponding parameter; merging values does not inherit param callbacks.

Return a Router for core to mount at the root, or mount it explicitly on `app`.
Use multiple route files for separate router groups. Module dependency order,
file-name order within a module, and native registration order determine execution.
The production starter shares its API prefix through pure `config/routes.ts`.
A root route `/` mounted at `/users` is documented as `/users/`.

Each endpoint still puts exactly one `rai({ id, ...schemas })` first in its method
chain. Existing checks for unsupported paths, duplicate IDs and duplicate
method/URL templates remain enforced. Arbitrary regular-expression/wildcard paths
and unknown router mount prefixes are rejected rather than guessed in specs.

## Inspection contract and compatibility

Offline inspection validates module manifests, dependency order, environment
contract structure/ownership and ACL. It imports the opted-in route files, builds
the actual router trees and uses the same scanner as runtime. Callback registration
does not execute middleware, param callbacks, handlers or access checkers.

It skips environment value resolution and env files, the app config seed and
settings declarations, models, controller acquisition through `runtime()`,
translation initialization, MongoDB/Redis, queues, sockets and bootstrap. Provider
declarations (`tulipes.providers` in the root manifest, `requires` in module
manifests) are validated for consistency, but the provider itself is never
resolved or imported, so an uninstalled provider is not an offline error.
Model metadata is not part of any generated document and is not an offline
capability; see the [spec package](../packages/spec/README.md#where-the-content-comes-from). Runtime environment
and credential validation remain strict. A runtime acquisition that changes
endpoint structure or replaces the access checker fails boot; declare that
structure in the router factory. Resource cleanup on acquisition failure remains
owned by the existing boot lifecycle.

Imports and router construction are trusted JavaScript, not a sandbox. Keep their
imports pure; put dependencies that connect services or read runtime configuration
inside `runtime()`. Choose paths from static shared constants. Applications whose
route structure depends on live configuration can retain ordinary `RoutesFn`
factories and use `--runtime`, the default for direct CLI invocations. Offline
inspection rejects non-opted-in modules before importing any route files and
rejects unwrapped route factories in opted-in modules.

Custom access policy is declared through the existing registry method:

```ts
const policy = runtime(async ctx => loadPolicy(ctx));
routes.setAccessChecker(policy(value => value.check));
```

Both runtime and offline scans see that a checker exists. Specs mark authorization
dynamic without claiming static roles or public access. Offline-compatible modules
must install checkers in `defineRoutes`, rather than runtime config factories.

Offline document title/version come from root package.json, with
`http://localhost:3000` as the default URL. Set `--url` for a deployment. Runtime
inspection retains config.app and PORT/PUBLIC_DOMAIN metadata.
`inspectRoutes({ rootDir })` from `@tulipes/core/boot` returns an `InspectionContext`
accepted directly by `@tulipes/spec`'s `extract()`, with no resources to shut down.

## Verification

Retained HTTP tests cover scoped middleware, shared and nested prefixes, inherited
parameters, parameter callbacks, callback acquisition once per boot, error-handler
arity, async rejection, next('route'), access checking and separate app instances.
Generated app tests compare normalized OpenAPI and Postman documents between
runtime and offline inspection. Packed checks generate documents in separate
processes with network connections denied and compare their bytes. The production
offline CI job has no MongoDB or Redis services.
