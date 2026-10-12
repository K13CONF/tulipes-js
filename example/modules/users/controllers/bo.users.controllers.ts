import { forgetUser } from "@app/auth";
import type { Request, RequestHandler, Response } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";

/**
 * The users back office — the users:bo:* endpoints, granted to admin
 * through its users:* grant. Same shape as the web controller beside it:
 * one class holding the context, one handler per method, failures thrown
 * as i18n keys.
 */
export class BoUsersController {
  readonly #ctx: Ctx;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
  }

  /** Soft delete: the row stays in mongo but leaves every ordinary query. */
  softDelete(): RequestHandler {
    return async (req: Request, res: Response) => {
      const user = await this.#ctx.models!.get("User").findOne({ email: req.params.email });
      if (!user) throw new HttpError(404, "notFound");

      // The account leaves every query, so its sessions resolve to nobody on
      // the cold path; the cached identities would not know, so they go too.
      await forgetUser(this.#ctx, String(user._id));
      await (user as unknown as { softDelete(): Promise<unknown> }).softDelete();
      res.respond({ data: { email: req.params.email, soft_deleted: true } });
    };
  }

  listDeleted(): RequestHandler {
    return async (_req: Request, res: Response) => {
      const deleted = await this.#ctx.models!
        .get("User")
        .find({ is_deleted: true })
        .setOptions({ withDeleted: true } as Record<string, unknown>)
        .select("email role -_id")
        .lean();

      res.respond({ data: deleted });
    };
  }

  create(): RequestHandler {
    return async (req: Request, res: Response) => {
      const { email } = (req.body ?? {}) as { email?: string };
      // `field` is what puts this against the input in the envelope.
      if (!email) throw new HttpError(422, "emailRequired", { field: "email" });

      await this.#ctx.models!.get("User").create({ email });
      // The locale travels with the job: the worker has no request to
      // negotiate from, so whoever queues the work owns that decision.
      await this.#ctx.queues!.add("users.welcome", "welcome", {
        email,
        locale: req.locale,
      });

      res.respond({ status: 201, data: { email, welcome_queued: true } });
    };
  }
}
