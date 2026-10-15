import { Router } from "express";
import type { BackendCtx } from "@tulipes/core/boot";
import { z } from "zod/v4";

import { WebAgentsController } from "../controllers/web.agents.controllers.ts";
import { approvalBody, runDetail, runIdParam, runListQuery, runRequest, runSummary } from "../schemas/agents.schemas.ts";

/**
 * A person's agent runs. Starting one queues it for the worker and answers
 * 202 at once; the run is followed with GET, answered with /approve when it
 * waits on a call that changes something, and stopped with /cancel.
 */
export default function webAgentsRoutes(ctx: BackendCtx): void {
  const { rai, routes, config } = ctx;
  const router = Router();
  const agents = new WebAgentsController(ctx);

  router.post("/runs", rai({
      id: "agents:web:runs:start",
      status: 202,
      name: "Start an agent run",
      description: "Queues a run that pursues the goal with the caller's permissions, narrowed by the credential's scopes",
      folder: "runs",
      body: runRequest,
      returns: runSummary,
    }), agents.start());

  router.get("/runs", rai({
      id: "agents:web:runs",
      name: "List my agent runs",
      description: "The caller's runs, newest first, without transcripts",
      folder: "runs",
      query: runListQuery,
      returns: z.array(runSummary),
    }), agents.list());

  router.get("/runs/:run_id", rai({
      id: "agents:web:runs:read",
      name: "Read an agent run",
      description: "One of the caller's runs: status, result, the calls it waits on, notes, steps and transcript",
      folder: "runs",
      params: runIdParam,
      returns: runDetail,
    }), agents.read());

  router.post("/runs/:run_id/approve", rai({
      id: "agents:web:runs:approve",
      name: "Answer an agent run's waiting calls",
      description: "Allow or deny each call the run waits on; the run resumes at once",
      folder: "runs",
      params: runIdParam,
      body: approvalBody,
      returns: runSummary,
    }), agents.approve());

  router.post("/runs/:run_id/cancel", rai({
      id: "agents:web:runs:cancel",
      name: "Cancel an agent run",
      description: "Stops the run; a call already running finishes, nothing after it starts",
      folder: "runs",
      params: runIdParam,
      returns: runSummary,
    }), agents.cancel());

  routes.mount(router, `${config.api!.prefix}/agents`);
}
