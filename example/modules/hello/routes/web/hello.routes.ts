import { Router } from "express";
import type { BackendCtx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";

import { HelloController } from "../../controllers/web/hello.controllers.ts";

/**
 * This module has two routes files for one scope, so they sit in a folder
 * named after it: routes/web/hello.routes.ts and
 * routes/web/hello.greetings.routes.ts. One file per scope would instead be
 * named scope-first at the top of routes/ (web.hello.routes.ts), as the
 * users module does. Neither is enforced; core reads every *.routes.ts.
 *
 * A routes file is a plain function of the context. It returns a Router,
 * which core mounts under `config.api.prefix`, and declares a RAI on every
 * endpoint: the id is the permission, and a route without one refuses the
 * boot. Build the router from the context; read models, settings and the
 * environment inside handlers, where they are live.
 */
export default function helloRoutes(ctx: BackendCtx): Router {
  const { rai } = ctx;
  const router = Router();
  const hello = new HelloController(ctx);

  router.get("/hello", rai({
      id: "hello:web:greet",
      name: "Greet",
      description: "Public greeting, granted to guest",
    }), hello.greet());

  router.get("/hello/secret", rai({
      id: "hello:web:secret",
      name: "Read the secret",
      description: "Requires a role granted hello:web:secret",
    }), hello.secret());

  router.get("/hello/:name", rai({
      id: "hello:web:greet:by-name",
      name: "Greet by name",
    }), hello.byName());

  router.get("/hello/demo/missing", rai({
      id: "hello:web:demo:missing",
      name: "HttpError demo",
    }), async () => {
      throw new HttpError(404, "nothing here", { details: { hint: "demo endpoint" } });
    });

  return router;
}
