import { Router } from "express";
import { defineRoutes } from "@tulipes/core/http";
import { apiPrefix } from "../../../config/routes.js";

export default defineRoutes(({ app, rai, routes, runtime }) => {
  const router = Router();
  const greetings = runtime(async ctx => {
    const { GreetingsController } = await import("../controllers/greetings.controllers.js");
    return new GreetingsController(ctx);
  });

  router.get("/greetings", rai({
      id: "hello:list-greetings",
      name: "List greetings",
      description: "Reads the seeded rows, clamped by the shared bounds",
    }), greetings(value => value.list()));

  router.post("/greetings/:name/use", rai({
      id: "hello:use-greeting",
      status: 202,
      name: "Use a greeting",
      description: "Queues a job that counts the use",
    }), greetings(value => value.use()));

  routes.mount(app, apiPrefix, router);
});
