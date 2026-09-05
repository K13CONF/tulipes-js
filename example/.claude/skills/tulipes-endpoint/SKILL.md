---
name: tulipes-endpoint
description: Use when adding or changing an HTTP endpoint in a Tulipes app, writing a controller, mounting middleware, or handling request errors. Covers the rai() declaration every route must carry, controller classes, and the request pipeline.
---

# Adding an endpoint

Two files: a controller class holding the work, and a routes file wiring
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
      if (!invoice) throw new HttpError(404, req.t("noSuchInvoice"));
      res.json(invoice);
    };
  }
}
```

Each method **returns** a handler rather than being one, so the routes file
reads as a table of contents and the class can keep private helpers beside
the handlers that use them without threading ctx through every signature.

`modules/billing/routes/billing.routes.ts`:

```ts
export default function billingRoutes(ctx: Ctx): Router {
  const { rai } = ctx;
  const router = Router();
  const billing = new BillingController(ctx);
  const base = String(ctx.config.api?.prefix ?? "");

  router.get(
    `${base}/invoices/:id`,
    rai({
      id: "invoices:read",
      name: "Read an invoice",
      description: "Returns one invoice by id",
    }),
    billing.show(),
  );

  return router;
}
```

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

`tulipes routes` lists every declared endpoint with the roles that reach
it.

## Errors

Throw `HttpError(status, message, details?)`. Express 5 forwards rejected
async handlers to the framework's terminal handler, so `throw` works
inside `async` without a try/catch.

- `HttpError` → `{ error, details? }` with your status.
- Middleware errors carrying a 4xx pass through (oversized body → 413,
  malformed JSON → 400).
- Anything else → anonymous `500`, real message only in development.
  **Never** catch an error just to `res.status(500).json(...)` yourself;
  that leaks what the framework hides.

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
- **Middleware for one feature** → `router.use(...)` in that module.
- Never mount middleware in `app.ts`, and never reorder by moving
  `app.use` calls — ordering is `tier` + `priority`.
