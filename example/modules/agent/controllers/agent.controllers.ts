import type { Request, RequestHandler, Response } from "express";
import type { BackendCtx } from "@tulipes/core/boot";
import { roleOf } from "@tulipes/core/http";

/**
 * The HTTP transport over `ctx.agent`: the manifest a role may call, and
 * the action endpoint. Route tools are not invoked here — the manifest
 * gives their method and path, and an agent calls them like any client,
 * through the same middleware.
 */
export class AgentController {
  constructor(private readonly ctx: BackendCtx) {}

  tools(): RequestHandler {
    return (req: Request, res: Response) => {
      res.respond({ data: this.ctx.agent.manifest(roleOf(req)) });
    };
  }

  invoke(): RequestHandler {
    return async (req: Request, res: Response) => {
      const name = String(req.params.name);
      const actor = { ...req.auth, role: roleOf(req) };
      res.respond({ data: await this.ctx.agent.invoke(name, req.body, actor, req) });
    };
  }
}
