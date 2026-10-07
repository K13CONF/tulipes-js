import { Router } from "express";
import { z } from "zod/v4";
import { defineRoutes } from "@tulipes/core/http";
export default defineRoutes(({ app, rai, routes }) => {
  const router = Router();
  router.get("/hello", rai({ id: "hello:read", name: "Hello", returns: z.object({ message: z.string() }) }), (req, res) => {
    res.respond({ data: { message: req.t("greeting") } });
  });
  routes.mount(app, "/api/v1", router);
});
