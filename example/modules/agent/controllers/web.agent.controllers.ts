import type { Request, RequestHandler, Response } from "express";
import type { BackendCtx } from "@tulipes/core/boot";
import { roleOf } from "@tulipes/core/http";

/**
 * The HTTP transport over `ctx.agent`, for agents outside the process:
 * the manifest a role may call, and the action endpoint. An agent inside
 * the app needs neither — it reads `ctx.agent` directly.
 */
export class WebAgentController {
  readonly #ctx: BackendCtx;

  constructor(ctx: BackendCtx) {
    this.#ctx = ctx;
  }

  tools(): RequestHandler {
    return (req: Request, res: Response) => {
      res.respond({ data: this.#ctx.agent.manifest(roleOf(req)) });
    };
  }

  invoke(): RequestHandler {
    return async (req: Request, res: Response) => {
      const name = String(req.params.name);
      const actor = { ...req.auth, role: roleOf(req) };
      res.respond({ data: await this.#ctx.agent.invoke(name, req.body, actor, req) });
    };
  }
}
