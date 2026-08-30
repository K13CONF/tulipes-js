import { Router } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";

export default function usersRoutes({ config, acl, models, queues }: Ctx): Router {
  const router = Router();

  router.get("/users", async (req, res) => {
    // Pagination bounds are app-wide (config/app.config.ts), so every list
    // endpoint in every module clamps the same way.
    const { defaultLimit = 20, maxLimit = 100 } = config.pagination ?? {};
    const requested = Number(req.query.limit ?? defaultLimit);
    const limit = Math.min(Number.isFinite(requested) ? requested : defaultLimit, maxLimit);

    const User = models!.get("User");
    const users = await User.find().select("email role -_id").limit(limit).lean();
    res.json({ count: users.length, limit, users });
  });

  // Soft delete via the app's base plugin: the document stays in mongo but
  // vanishes from every ordinary query.
  router.delete("/users/:email", async (req, res) => {
    const User = models!.get("User");
    const user = await User.findOne({ email: req.params.email });
    if (!user) throw new HttpError(404, "no such user");
    await (user as unknown as { softDelete(): Promise<unknown> }).softDelete();
    res.json({ email: req.params.email, softDeleted: true });
  });

  router.get("/users/deleted", async (_req, res) => {
    const User = models!.get("User");
    const deleted = await User.find({ is_deleted: true })
      .setOptions({ withDeleted: true } as Record<string, unknown>)
      .select("email role -_id")
      .lean();
    res.json({ count: deleted.length, deleted });
  });

  router.post("/users", async (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) {
      res.status(422).json({ error: "email is required" });
      return;
    }
    const User = models!.get("User");
    await User.create({ email });
    await queues!.add("users.welcome", "welcome", { email });
    res.status(201).json({ email, welcomeQueued: true });
  });

  // Error-handling demo: HttpError is the whole story a module needs —
  // async throws land in core's terminal error handler.
  router.get("/users/missing", async () => {
    throw new HttpError(404, "no such user", { hint: "demo endpoint" });
  });
  router.get("/users/boom", async () => {
    throw new Error("secret internals that must not leak in production");
  });

  router.get("/users/ping", (_req, res) => {
    res.json({
      module: "users",
      maxSessions: config.users?.maxSessions,
      acl: {
        adminWrite: acl!.can("admin", "users:write"), // via the "*" grant
        userRead: acl!.can("user", "users:read"),
        userWrite: acl!.can("user", "users:write"),
        ghostRole: acl!.can("ghost", "users:read"), // unknown role denies
      },
    });
  });

  return router;
}
