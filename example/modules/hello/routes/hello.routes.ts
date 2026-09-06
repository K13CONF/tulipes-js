import { Router } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";

import { HelloController } from "../controllers/hello.controllers.js";

export default function helloRoutes(ctx: Ctx): Router {
  const { rai } = ctx;
  const router = Router();
  const hello = new HelloController(ctx);

  // Built from the shared prefix, so versioning the whole API is a
  // one-line change in config/app.config.ts.
  const base = String(ctx.config.api?.prefix ?? "");

  // Every route declares a RAI: the id is the ACL permission, and core
  // refuses to boot if a route forgets one. "Public" is a grant to the
  // guest role in module.acl.ts, not a missing check.
  router.get(
    `${base}/hello`,
    rai({
      id: "hello:greet",
      name: "Greet",
      description: "Public greeting, granted to guest",
    }),
    hello.greet(),
  );

  // Literal paths must be registered before parameterised ones, or
  // "/hello/:name" would swallow this.
  router.get(
    `${base}/hello/secret`,
    rai({
      id: "hello:read",
      name: "Read the secret",
      description: "Requires a role granted hello:read",
    }),
    hello.secret(),
  );

  router.get(
    `${base}/hello/:name`,
    rai({
      id: "hello:greet-name",
      name: "Greet by name",
    }),
    hello.byName(),
  );

  // Throwing is the whole error story — the framework's terminal handler
  // renders it. Express 5 forwards async rejections there too.
  router.get(
    `${base}/hello/demo/missing`,
    rai({
      id: "hello:demo-missing",
      name: "HttpError demo",
    }),
    async () => {
      throw new HttpError(404, "nothing here", { details: { hint: "demo endpoint" } });
    },
  );

  return router;
}
