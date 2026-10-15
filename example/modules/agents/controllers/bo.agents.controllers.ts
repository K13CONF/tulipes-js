import type { Request, RequestHandler, Response } from "express";
import type { RuntimeCtx } from "@tulipes/core/boot";

import { cancelRun, listRuns, readRun } from "../helpers/runs.ts";

/**
 * Every run, for the back office: follow any of them and stop one. Not
 * approve — a run acts with its owner's authority, so only its owner
 * consents to what it changes.
 */
export class BoAgentsController {
  readonly #ctx: RuntimeCtx;

  constructor(ctx: RuntimeCtx) {
    this.#ctx = ctx;
  }

  list(): RequestHandler {
    return async (req: Request, res: Response) => {
      const { per_page, skip } = req.page;
      const { runs, total } = await listRuns(this.#ctx, null, { skip, limit: per_page, status: req.query.status as string | undefined });
      res.respond({ data: runs, meta: { total_items: total } });
    };
  }

  read(): RequestHandler {
    return async (req: Request, res: Response) => {
      res.respond({ data: await readRun(this.#ctx, null, String(req.params.run_id)) });
    };
  }

  cancel(): RequestHandler {
    return async (req: Request, res: Response) => {
      res.respond({ data: await cancelRun(this.#ctx, null, String(req.params.run_id)) });
    };
  }
}
