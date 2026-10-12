import type { Request, RequestHandler, Response } from "express";
import type { Ctx } from "@tulipes/core/boot";

import { buildGreeting } from "../../helpers/greeting.ts";

/**
 * Controllers hold the work so routes stay a table of contents. The
 * framework does not scan this folder — routes import the class directly,
 * which keeps the wiring explicit.
 *
 * Taking ctx in the constructor is what makes it testable: construct one
 * with a stub context and call the method.
 */
export class HelloController {
  readonly #ctx: Ctx;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
  }

  greet(): RequestHandler {
    return (req: Request, res: Response): void => {
      const name = String(req.query.name ?? "world");
      // Every response goes through res.respond, which wraps the payload
      // in the app's envelope: { success, data, errors, meta }.
      res.respond({
        data: {
          message: buildGreeting(String(this.#ctx.config.hello?.greeting), name),
          app: this.#ctx.config.app?.name,
        },
      });
    };
  }

  secret(): RequestHandler {
    return (req: Request, res: Response): void => {
      // req.t is bound to this module's namespace by rai(), so the key
      // resolves in modules/hello/i18n/<locale>.json. Try ?lang=fr.
      res.respond({ data: { secret: req.t("secret"), locale: req.locale } });
    };
  }

  byName(): RequestHandler {
    return (req: Request, res: Response): void => {
      res.respond({
        data: { message: `${this.#ctx.config.hello?.greeting}, ${req.params.name}!` },
      });
    };
  }
}
