import { Router } from "express";
import type { BackendCtx } from "@tulipes/core/boot";

import { AgentController } from "../controllers/agent.controllers.js";
import { toolInput, toolName } from "../schemas/agent.schemas.js";

export default function agentRoutes(ctx: BackendCtx): void {
  const { rai, routes, config } = ctx;
  const router = Router();
  const agent = new AgentController(ctx);

  router.get("/tools", rai({
      id: "agent:tools",
      name: "List the tools an agent may call",
      description: "The manifest filtered to the caller's role: route tools with their method and path, actions with their input schema",
      agent: false,
    }), agent.tools());

  router.post("/tools/:name", rai({
      id: "agent:invoke",
      name: "Run a declared action",
      description: "Runs an action from a module's agent declaration; the action's own permission and input schema apply",
      params: toolName,
      body: toolInput,
      agent: false,
    }), agent.invoke());

  routes.mount(router, `${config.api!.prefix}/agent`);
}
