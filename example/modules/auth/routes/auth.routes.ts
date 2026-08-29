import { Router } from "express";
import type { Ctx } from "@tulipes/core/boot";

export default function authRoutes(_ctx: Ctx): Router {
  const router = Router();

  router.get("/auth/ping", (_req, res) => {
    res.json({ module: "auth" });
  });

  return router;
}
