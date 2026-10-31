import { forgetUser } from "@app/auth";
import type { Request, RequestHandler, Response } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";
import { runQuery, toMongoose, type ParsedListQuery } from "@app/core";

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

  /**
   * users:bo:list. rai has already parsed and policed the query, so
   * req.query is the AST; this compiles it, runs it, and responds. A
   * `system` filter here (a tenant, an owner) would be ANDed outside
   * anything the client sent. Soft-deleted users need none: the model's
   * plugin already keeps them out of find, count and aggregate.
   */
  list(): RequestHandler {
    return async (req: Request, res: Response) => {
      // App-wide defaults (config.pagination.maxTimeMs) apply; pass { maxTimeMS } here to override.
      const compiled = toMongoose(req.query as unknown as ParsedListQuery, req.page);
      const { data, total_items } = await runQuery(this.#ctx.models!.get("User"), compiled);
      res.respond({ data, meta: total_items === undefined ? {} : { total_items } });
    };
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
