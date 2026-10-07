import type { Request, RequestHandler, Response } from "express";
import { requireModels, type Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";

export class GreetingsController {
  readonly #ctx: Ctx;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
  }

  list(): RequestHandler {
    return async (req: Request, res: Response) => {
      // ?page and ?per_page, already clamped by config.pagination — so
      // every list endpoint in every module paginates the same way.
      const { per_page, skip } = req.page;
      const Greeting = requireModels(this.#ctx).get("Greeting");

      const [greetings, total_items] = await Promise.all([
        Greeting.find().select("name message times_used -_id")
          .skip(skip).limit(per_page).lean(),
        Greeting.countDocuments(),
      ]);

      // Passing total_items is what marks this a page: respond fills in
      // page, per_page and total_pages from the request and the count.
      res.respond({ data: greetings, meta: { total_items } });
    };
  }

  use(): RequestHandler {
    return async (req: Request, res: Response) => {
      const name = String(req.params.name);
      const greeting = await requireModels(this.#ctx).get("Greeting").findOne({ name }).lean();
      if (!greeting) throw new HttpError(404, "noSuchGreeting", { vars: { name } });
      // Without a queues provider the count is updated in the request itself.
      await requireModels(this.#ctx).get("Greeting").updateOne({ name }, { $inc: { times_used: 1 } });
      res.respond({ data: { name, message: greeting.message } });
    };
  }
}
