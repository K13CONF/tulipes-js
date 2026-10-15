import { Router } from "express";
import type { BackendCtx } from "@tulipes/core/boot";
import { z } from "zod/v4";

import { BoAgentsController } from "../controllers/bo.agents.controllers.ts";
import { runDetail, runIdParam, runListQuery, runSummary } from "../schemas/agents.schemas.ts";

/** Every agent run, for the back office: follow and stop, never approve. */
export default function boAgentsRoutes(ctx: BackendCtx): void {
  const { rai, routes, config } = ctx;
  const router = Router();
  const agents = new BoAgentsController(ctx);

  router.get("/runs", rai({
      id: "agents:bo:runs",
      name: "List all agent runs",
      description: "Every run, newest first, without transcripts",
      folder: "runs (back office)",
      query: runListQuery,
      returns: z.array(runSummary),
    }), agents.list());

  router.get("/runs/:run_id", rai({
      id: "agents:bo:runs:read",
      name: "Read any agent run",
      description: "Any run, with its transcript and steps",
      folder: "runs (back office)",
      params: runIdParam,
      returns: runDetail,
    }), agents.read());

  router.post("/runs/:run_id/cancel", rai({
      id: "agents:bo:runs:cancel",
      name: "Cancel any agent run",
      description: "Stops a run whoever started it",
      folder: "runs (back office)",
      params: runIdParam,
      returns: runSummary,
    }), agents.cancel());

  routes.mount(router, `${config.api!.prefix}/agents/bo`);
}
