---
name: tulipes-endpoint
description: Use when adding or changing an HTTP endpoint in a Tulipes app, mounting middleware, handling request errors, or wondering where global middleware goes. Covers the routes contract, HttpError, validation and the request pipeline order.
---

# Adding an endpoint

Routes live in `modules/<name>/routes/*.routes.ts`. The file
default-exports a function that receives the context and returns a Router.

```ts
import { Router } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";

export default function billingRoutes({ config, models }: Ctx): Router {
  const router = Router();

  router.get("/invoices/:id", async (req, res) => {
    const invoice = await models!.get("Invoice").findById(req.params.id).lean();
    if (!invoice) throw new HttpError(404, "no such invoice");
    res.json(invoice);
  });

  return router;
}
```

Then `yarn dev` and hit the route. Nothing else is registered anywhere —
the framework discovers the file.

## Errors

Throw `HttpError(status, message, details?)`. Express 5 forwards rejected
async handlers to the framework's terminal handler, so `throw` works
inside `async` routes without a try/catch.

- `HttpError` → `{ error, details? }` with your status.
- Middleware errors carrying a 4xx (oversized body → 413, malformed JSON →
  400) are passed through.
- Anything else → anonymous `500`, with the real message only in
  development. **Never** catch an error just to `res.status(500).json(...)`
  yourself; you would leak internals that the framework hides.

## The request pipeline

```
module routers, in load order:
  sys modules      global middleware (request ids, helmet, cors, logging, body parsing)
  app modules      your feature routes
notFoundHandler    framework — 404 for anything unclaimed
errorHandler       framework — terminal
```

- **Middleware for every request** → a sys-tier module's routes file,
  mounted on `ctx.app` (that file returns nothing). Sys modules load
  first, which is what puts it ahead of all feature routes.
- **Middleware for one feature** → `router.use(...)` inside that module's
  own routes file, or per-route as a handler argument.
- Never mount middleware in `app.ts`, and never reorder by moving
  `app.use` calls around — ordering is `tier` + `priority`.

## Permissions

Check with the ACL rather than ad-hoc role comparisons:

```ts
if (!acl!.can(req.user.role, "invoices:write")) {
  throw new HttpError(403, "forbidden");
}
```

Grants are declared in `module.acl.ts` → skill `tulipes-permissions`.

## Conventions worth following

- Validate input at the edge and throw `HttpError(422, …)` with details.
- Clamp list endpoints with the shared bounds:
  `config.pagination!.defaultLimit` / `maxLimit`.
- Build paths from `config.api!.prefix` instead of hardcoding `/api/v1`.
- Keep handlers thin; put real work in `controllers/` or `helpers/` and
  import it directly (the framework does not scan those folders).
