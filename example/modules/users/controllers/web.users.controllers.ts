import type { Request, RequestHandler, Response } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";

/**
 * One class per controller, holding the context. Each method returns a
 * handler, so the routes file stays a table of contents. The class is
 * named after its file — web.users.controllers.ts, WebUsersController —
 * and serves the users:web:* endpoints; the back office has its own.
 *
 * Every response goes through `res.respond`, which wraps the payload in
 * the app's envelope. Failures are thrown rather than responded — the
 * framework's terminal handler builds the same envelope from them — so a
 * handler only ever writes the happy path.
 *
 * Thrown messages are i18n KEYS: the handler translates them in this
 * module's namespace and derives the error code from the key, so
 * "notFound" becomes NOT_FOUND with a translated message.
 */
export class WebUsersController {
  readonly #ctx: Ctx;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
  }

  list(): RequestHandler {
    return async (req: Request, res: Response) => {
      // ?page and ?per_page, already clamped by config.pagination.
      const { per_page, skip } = req.page;
      const User = this.#ctx.models!.get("User");

      const [users, total_items] = await Promise.all([
        User.find().select("email role -_id").skip(skip).limit(per_page).lean(),
        User.countDocuments(),
      ]);

      // Passing total_items is what marks this a page: respond fills in
      // page, per_page and total_pages from the request and the count.
      res.respond({ data: users, meta: { total_items } });
    };
  }

  ping(): RequestHandler {
    return (req: Request, res: Response) => {
      res.respond({
        data: {
          module: "users",
          locale: req.locale,
          max_sessions: this.#ctx.config.users?.maxSessions,
        },
      });
    };
  }

  /** Demonstrates HttpError — the framework renders it into the envelope. */
  demoMissing(): RequestHandler {
    return async () => {
      throw new HttpError(404, "notFound", { details: { hint: "demo endpoint" } });
    };
  }

  /** Demonstrates an unexpected error: anonymous 500 outside development. */
  demoBoom(): RequestHandler {
    return async () => {
      throw new Error("secret internals that must not leak in production");
    };
  }
}
