import { Router } from "express";
import type { Ctx } from "@tulipes/core/boot";

import { GreetingsController } from "../controllers/greetings.controllers.js";

/**
 * A module may ship several routes files; each is discovered and mounted
 * independently. This one shows the database and the queue.
 */
export default function greetingsRoutes(ctx: Ctx): Router {
  const { rai } = ctx;
  const router = Router();
  const greetings = new GreetingsController(ctx);
  const base = String(ctx.config.api?.prefix ?? "");

  router.get(
    `${base}/greetings`,
    rai({
      id: "hello:list-greetings",
      name: "List greetings",
      description: "Reads the seeded rows, clamped by the shared bounds",
    }),
    greetings.list(),
  );

  router.post(
    `${base}/greetings/:name/use`,
    rai({
      id: "hello:use-greeting",
      name: "Use a greeting",
      description: "Queues a job that counts the use",
    }),
    greetings.use(),
  );

  return router;
}
