import { Router } from "express";
import type { Ctx } from "@tulipes/core/boot";

import { UsersController } from "../controllers/users.controllers.js";

export default function usersRoutes(ctx: Ctx): Router {
  const { rai } = ctx;
  const router = Router();
  const users = new UsersController(ctx);

  // Every route declares a RAI. The id gates the route and documents it,
  // and core refuses to boot when one is missing — so a forgotten guard is
  // a failed deploy rather than a silently public endpoint.
  router.get(
    "/users",
    rai({
      id: "users:read",
      name: "List users",
      description: "Page through accounts, clamped by the shared bounds",
    }),
    users.list(),
  );

  router.delete(
    "/users/:email",
    rai({
      id: "users:delete",
      name: "Soft-delete a user",
      description: "Flags the account; ordinary queries stop returning it",
    }),
    users.softDelete(),
  );

  router.get(
    "/users/deleted",
    rai({
      id: "users:read-deleted",
      name: "List soft-deleted users",
    }),
    users.listDeleted(),
  );

  router.post(
    "/users",
    rai({
      id: "users:create",
      name: "Create a user",
      description: "Adds the account and queues its welcome email",
    }),
    users.create(),
  );

  router.get(
    "/users/ping",
    rai({
      id: "users:ping",
      name: "Users module status",
    }),
    users.ping(),
  );

  router.get(
    "/users/missing",
    rai({
      id: "users:demo-missing",
      name: "HttpError demo",
    }),
    users.demoMissing(),
  );

  router.get(
    "/users/boom",
    rai({
      id: "users:demo-boom",
      name: "Unhandled error demo",
    }),
    users.demoBoom(),
  );

  return router;
}
