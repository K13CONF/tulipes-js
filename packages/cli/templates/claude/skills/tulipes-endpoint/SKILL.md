---
name: tulipes-endpoint
description: Use when adding or changing an HTTP endpoint in a Tulipes app, writing a controller, mounting middleware, or handling request errors. Covers the rai() declaration every route must carry, controller classes, and the request pipeline.
---

# Adding an endpoint

Two files: a controller class holding the work, and a shared declaration file wiring
it up. Every route declares a RAI — a Resource Access Identifier — and the
app refuses to boot if one is missing.

`modules/billing/controllers/billing.controllers.ts`:

```ts
import type { Request, RequestHandler, Response } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";

export class BillingController {
  constructor(private readonly ctx: Ctx) {}

  show(): RequestHandler {
    return async (req: Request, res: Response) => {
      const invoice = await this.ctx.models!.get("Invoice").findById(req.params.id).lean();
      if (!invoice) throw new HttpError(404, "noSuchInvoice");
      res.respond({ data: invoice });
    };
  }
}
```

Each method **returns** a handler rather than being one, so the routes file
reads as a table of contents and the class can keep private helpers beside
the handlers that use them without threading ctx through every signature.

`modules/billing/routes/billing.routes.ts`:

```ts
import { Router } from "express";
import { defineRoutes } from "@tulipes/core/http";

export default defineRoutes(({ app, rai, routes, runtime }) => {
  const router = Router();
  const billing = runtime(async ctx => {
    const { BillingController } = await import("../controllers/billing.controllers.js");
    return new BillingController(ctx);
  });
  router.get("/:id", rai({ id: "billing:read", name: "Read an invoice" }),
    billing(value => value.show()));
  routes.mount(app, "/invoices", router);
});
```

Set tulipes.offline: true in the module manifest. runtime() acquires each controller
once at boot, and its binder selects callbacks before listening. Offline inspection
builds real routers without running acquisition functions or callback selectors.
Keep service-dependent imports inside runtime(). Pure callbacks need no binding.

Use router.use for shared middleware, router.param for parameter callbacks, and
router.route for chained method registrations. The same binder supports all
callback kinds, including error handlers. Preserve native registration order.
Parameter callbacks run before endpoint RAI; authorization-sensitive loading
belongs after rai() or behind an appropriate earlier authorization check.

Use routes.mount for nested/shared prefixes, including named parameters. Set
Router({mergeParams:true}) on children needing inherited parameter values.
Existing RoutesFn factories remain supported with --runtime. After changes run
the app tests, tulipes routes --offline and pnpm spec; inspect generated diffs.

## The RAI is not optional

`id` names a resource and an access to it, and **is** the ACL permission.
One declaration identifies the endpoint, gates it, marks the route as
declared, and binds `req.t` to the declaring module's i18n namespace —
which is why the message above needs no namespace of its own. → skill
`tulipes-i18n` Core walks the router stack after mounting; a route without a
RAI, or two routes sharing an id, abort the boot:

```
TulipesBootError: Boot aborted during "routes" — 1 issue(s):
  ✖ GET /api/v1/invoices has no rai() declaration — every route must
    declare one, or it is reachable by anyone
```

This exists because the pipeline authenticates rather than rejects: an
undeclared route is not merely undocumented, it is reachable by `guest`.
Grant the id in `module.acl.ts` — to `guest` if the endpoint is public.

`tulipes routes --offline` lists every declared endpoint with the roles that reach
it.

## Responses and errors

Every response goes through `res.respond`, which builds the app's
envelope — `{ success, data, errors, meta }`. Failures are **thrown**, and
the terminal handler builds the same envelope from them, so a handler only
ever writes the happy path. → skill `tulipes-response`

```ts
res.respond({ data: invoice });
res.respond({ data: invoices, meta: { total_items } });   // paginated
throw new HttpError(404, "noSuchInvoice");                // → NOT_FOUND
```

Express 5 forwards rejected async handlers to the terminal handler, so
`throw` works inside `async` without a try/catch.

- Middleware errors carrying a 4xx pass through (oversized body → 413,
  malformed JSON → 400).
- Anything else → anonymous `500`, real message only in development.
  **Never** catch an error just to `res.status(500).json(...)` yourself;
  that leaks what the framework hides.
- **Never `res.json`** — it ships a raw, unenveloped body. Development
  logs a warning naming the route; production does not.

## The request pipeline

```
module routers, in load order:
  sys modules      request ids, helmet, cors, logging, body parsing,
                   then auth resolving req.auth (guest if no token)
  app modules      your feature routes, each gated by its RAI
notFoundHandler    framework — 404 for anything unclaimed
errorHandler       framework — terminal
```

- **Middleware for every request** → a sys-tier module's routes file,
  mounted on `ctx.app` (that file returns nothing).
- **Middleware for one router** → router.use before its endpoints.
- **Middleware for one endpoint** → put callbacks after its rai() handler.
- Never mount middleware in `app.ts`, and never reorder by moving
  `app.use` calls — ordering is `tier` + `priority`.
