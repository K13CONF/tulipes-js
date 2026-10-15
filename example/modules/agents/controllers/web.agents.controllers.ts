import type { Request, RequestHandler, Response } from "express";
import type { RuntimeCtx } from "@tulipes/core/boot";

import type { Decision } from "../helpers/harness/contracts.ts";
import { approveRun, cancelRun, listRuns, ownerOf, readRun, startRun } from "../helpers/runs.ts";

/**
 * A person's own agent runs: start one, follow it, answer what it waits
 * on, stop it. Every handler is a use case from helpers/runs.ts with the
 * caller as its owner — another person's run is not found.
 */
export class WebAgentsController {
  readonly #ctx: RuntimeCtx;

  constructor(ctx: RuntimeCtx) {
    this.#ctx = ctx;
  }

  start(): RequestHandler {
    return async (req: Request, res: Response) => {
      res.respond({ status: 202, data: await startRun(this.#ctx, req.auth, req.body as { goal: string; context?: string }) });
    };
  }

  list(): RequestHandler {
    return async (req: Request, res: Response) => {
      const { per_page, skip } = req.page;
      const { runs, total } = await listRuns(this.#ctx, ownerOf(req.auth), { skip, limit: per_page, status: req.query.status as string | undefined });
      res.respond({ data: runs, meta: { total_items: total } });
    };
  }

  read(): RequestHandler {
    return async (req: Request, res: Response) => {
      res.respond({ data: await readRun(this.#ctx, ownerOf(req.auth), String(req.params.run_id)) });
    };
  }

  cancel(): RequestHandler {
    return async (req: Request, res: Response) => {
      res.respond({ data: await cancelRun(this.#ctx, ownerOf(req.auth), String(req.params.run_id)) });
    };
  }

  approve(): RequestHandler {
    return async (req: Request, res: Response) => {
      const { decisions } = req.body as { decisions: Record<string, Decision> };
      res.respond({ data: await approveRun(this.#ctx, ownerOf(req.auth), String(req.params.run_id), decisions) });
    };
  }
}
