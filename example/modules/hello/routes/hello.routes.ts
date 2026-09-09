import { Router } from "express";
import { defineRoutes } from "@tulipes/core/http";
import { apiPrefix } from "../../../config/routes.js";
import { HttpError } from "@tulipes/core/http";

export default defineRoutes(({ app, rai, routes, runtime }) => {
  const router = Router();
  const hello = runtime(async ctx => {
    const { HelloController } = await import("../controllers/hello.controllers.js");
    return new HelloController(ctx);
  });

  router.get("/hello", rai({
      id: "hello:greet",
      name: "Greet",
      description: "Public greeting, granted to guest",
    }), hello(value => value.greet()));

  router.get("/hello/secret", rai({
      id: "hello:read",
      name: "Read the secret",
      description: "Requires a role granted hello:read",
    }), hello(value => value.secret()));

  router.get("/hello/:name", rai({
      id: "hello:greet-name",
      name: "Greet by name",
    }), hello(value => value.byName()));

  router.get("/hello/demo/missing", rai({
      id: "hello:demo-missing",
      name: "HttpError demo",
    }), async () => {
      throw new HttpError(404, "nothing here", { details: { hint: "demo endpoint" } });
    });

  routes.mount(app, apiPrefix, router);
});
