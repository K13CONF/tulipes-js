import { Router } from "express";
import { defineRoutes } from "@tulipes/core/http";
export default defineRoutes(({ rai }) => {
  const router = Router();
  router.get("/health", rai({ id: "core:health", name: "Health" }), (_req, res) => {
    res.respond({ data: { status: "ok" } });
  });
  return router;
});
