import { Router } from "express";
import type { BackendCtx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";

import { HelloController } from "../controllers/hello.controllers.ts";

/**
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
      id: "hello:greet",
      name: "Greet",
      description: "Public greeting, granted to guest",
    }), hello.greet());

  router.get("/hello/secret", rai({
      id: "hello:read",
      name: "Read the secret",
      description: "Requires a role granted hello:read",
    }), hello.secret());

  router.get("/hello/:name", rai({
      id: "hello:greet-name",
      name: "Greet by name",
    }), hello.byName());

  router.get("/hello/demo/missing", rai({
      id: "hello:demo-missing",
      name: "HttpError demo",
    }), async () => {
      throw new HttpError(404, "nothing here", { details: { hint: "demo endpoint" } });
    });

  return router;
}
