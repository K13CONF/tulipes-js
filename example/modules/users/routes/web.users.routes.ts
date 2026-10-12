import { Router } from "express";
import type { BackendCtx } from "@tulipes/core/boot";
import { z } from "zod/v4";

import { WebUsersController } from "../controllers/web.users.controllers.ts";
import { listQuery, userShape } from "../schemas/users.schemas.ts";

/**
 * The users endpoints a signed-in client calls. The back office's sit in
 * bo.users.routes.ts beside this file, under the same mount: one file per
 * scope, named scope-first.
 */
export default function webUsersRoutes(ctx: BackendCtx): void {
  const { rai, routes } = ctx;
  const router = Router();
  const users = new WebUsersController(ctx);

  router.get("/", rai({
      id: "users:web:list",
      name: "List users",
      description: "Page through accounts, clamped by the shared bounds",
      // Validated on the way in, and described on the way out: one
      // declaration, so the spec cannot drift from what is enforced.
      query: listQuery,
      returns: z.array(userShape),
    }), users.list());

  router.get("/ping", rai({
      id: "users:web:ping",
      name: "Users module status",
    }), users.ping());

  router.get("/missing", rai({
      id: "users:web:demo:missing",
      name: "HttpError demo",
    }), users.demoMissing());

  router.get("/boom", rai({
      id: "users:web:demo:boom",
      name: "Unhandled error demo",
    }), users.demoBoom());

  // Deliberately outside the API prefix, to show a mount of its own.
  routes.mount(router, "/users");
}
