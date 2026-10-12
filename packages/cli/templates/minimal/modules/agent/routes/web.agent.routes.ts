import { Router } from "express";
import { z } from "zod/v4";
import type { BackendCtx } from "@tulipes/core/boot";
import { roleOf } from "@tulipes/core/http";

/** The agent door: the manifest a role may call, and the action endpoint. */
export default function agentRoutes(ctx: BackendCtx): Router {
  const { rai } = ctx;
  const router = Router();
  router.get("/agent/tools", rai({ id: "agent:web:tools", name: "Tools an agent may call" }), (req, res) => {
    res.respond({ data: ctx.agent.manifest(roleOf(req)) });
  });
  router.post("/agent/tools/:name", rai({
    id: "agent:web:invoke", name: "Run a declared action",
    params: z.object({ name: z.string() }), body: z.looseObject({}),
  }), async (req, res) => {
    res.respond({ data: await ctx.agent.invoke(String(req.params.name), req.body, { ...req.auth, role: roleOf(req) }, req) });
  });
  return router;
}
