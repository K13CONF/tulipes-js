import { Router } from "express";
import type { BackendCtx } from "@tulipes/core/boot";

import { WebAgentController } from "../controllers/web.agent.controllers.ts";
import { toolInput, toolName } from "../schemas/agent.schemas.ts";

export default function agentRoutes(ctx: BackendCtx): void {
  const { rai, routes, config } = ctx;
  const router = Router();
  const agent = new WebAgentController(ctx);

  router.get("/tools", rai({
      id: "agent:web:tools",
      name: "List the tools an agent may call",
      description: "The manifest filtered to the caller's role: route tools with their method and path, actions with their input schema",
    }), agent.tools());

  router.post("/tools/:name", rai({
      id: "agent:web:invoke",
      name: "Run a declared action",
      description: "Runs an action from a module's agent declaration; the action's own permission and input schema apply",
      params: toolName,
      body: toolInput,
    }), agent.invoke());

  routes.mount(router, `${config.api!.prefix}/agent`);
}
