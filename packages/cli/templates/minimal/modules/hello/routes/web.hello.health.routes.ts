import { Router } from "express";
import type { BackendCtx } from "@tulipes/core/boot";
export default function healthRoutes({ rai, routes }: BackendCtx): void {
  const router = Router();
  router.get("/health", rai({ id: "hello:web:health", name: "Health" }), (_req, res) => {
    res.respond({ data: { status: "ok" } });
  });
  routes.mount(router, "");
}
