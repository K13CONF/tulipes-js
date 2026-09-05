import type { Request, RequestHandler, Response } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";

/**
 * One class per controller, holding the context. Each method returns a
 * handler, so the routes file stays a table of contents.
 *
 * `req.t` is already bound to this module's namespace — every key below
 * reads modules/users/i18n/<locale>.json, negotiated per request.
 */
export class UsersController {
  constructor(private readonly ctx: Ctx) {}

  list(): RequestHandler {
    return async (req: Request, res: Response) => {
      const limit = this.#limit(req);
      const users = await this.ctx.models!
        .get("User")
        .find()
        .select("email role -_id")
        .limit(limit)
        .lean();

      res.json({
        // i18next picks the plural form from `count`, which is why the key
        // has _one/_other variants rather than a hand-written ternary.
        summary: req.t("list.count", { count: users.length }),
        limit,
        users,
      });
    };
  }

  /** Soft delete: the row stays in mongo but leaves every ordinary query. */
  softDelete(): RequestHandler {
    return async (req: Request, res: Response) => {
      const user = await this.ctx.models!.get("User").findOne({ email: req.params.email });
      if (!user) throw new HttpError(404, req.t("notFound"));

      await (user as unknown as { softDelete(): Promise<unknown> }).softDelete();
      res.json({
        message: req.t("deleted", { email: req.params.email }),
        email: req.params.email,
        softDeleted: true,
      });
    };
  }

  listDeleted(): RequestHandler {
    return async (_req: Request, res: Response) => {
      const deleted = await this.ctx.models!
        .get("User")
        .find({ is_deleted: true })
        .setOptions({ withDeleted: true } as Record<string, unknown>)
        .select("email role -_id")
        .lean();

      res.json({ count: deleted.length, deleted });
    };
  }

  create(): RequestHandler {
    return async (req: Request, res: Response) => {
      const { email } = (req.body ?? {}) as { email?: string };
      if (!email) throw new HttpError(422, req.t("emailRequired"));

      await this.ctx.models!.get("User").create({ email });
      // The locale travels with the job: the worker has no request to
      // negotiate from, so whoever queues the work owns that decision.
      await this.ctx.queues!.add("users.welcome", "welcome", {
        email,
        locale: req.locale,
      });

      res.status(201).json({
        message: req.t("created", { email }),
        email,
        welcomeQueued: true,
      });
    };
  }

  ping(): RequestHandler {
    return (req: Request, res: Response) => {
      res.json({
        module: "users",
        locale: req.locale,
        maxSessions: this.ctx.config.users?.maxSessions,
      });
    };
  }

  /** Demonstrates HttpError — the framework renders it. */
  demoMissing(): RequestHandler {
    return async (req: Request) => {
      throw new HttpError(404, req.t("notFound"), { hint: "demo endpoint" });
    };
  }

  /** Demonstrates an unexpected error: anonymous 500 outside development. */
  demoBoom(): RequestHandler {
    return async () => {
      throw new Error("secret internals that must not leak in production");
    };
  }

  /** Pagination bounds are app-wide, so every list endpoint clamps alike. */
  #limit(req: Request): number {
    const { defaultLimit = 20, maxLimit = 100 } = this.ctx.config.pagination ?? {};
    const asked = Number(req.query.limit ?? defaultLimit);
    return Math.min(Number.isFinite(asked) ? asked : defaultLimit, maxLimit);
  }
}
