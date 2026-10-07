import { Router } from "express";
import type { BackendCtx } from "@tulipes/core/boot";

import { GreetingsController } from "../controllers/greetings.controllers.js";

export default function greetingsRoutes(ctx: BackendCtx): Router {
  const { rai } = ctx;
  const router = Router();
  const greetings = new GreetingsController(ctx);

  router.get("/greetings", rai({
      id: "hello:list-greetings",
      name: "List greetings",
      description: "Reads the seeded rows, clamped by the shared bounds",
    }), greetings.list());

  router.post("/greetings/:name/use", rai({
      id: "hello:use-greeting",
      status: 202,
      name: "Use a greeting",
      description: "Queues a job that counts the use",
    }), greetings.use());

  return router;
}
