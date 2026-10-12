import { Router } from "express";
import { z } from "zod/v4";
import type { BackendCtx } from "@tulipes/core/boot";
export default function helloRoutes({ rai }: BackendCtx): Router {
  const router = Router();
  router.get("/hello", rai({ id: "hello:web:read", name: "Hello", returns: z.object({ message: z.string() }) }), (req, res) => {
    res.respond({ data: { message: req.t("greeting") } });
  });
  return router;
}
