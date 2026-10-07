import { Router } from "express";
import type { BackendCtx } from "@tulipes/core/boot";
import { z } from "zod/v4";

import { UsersController } from "../controllers/users.controllers.ts";
import { createBody, emailParam, listQuery, userShape } from "../schemas/users.schemas.ts";

export default function usersRoutes(ctx: BackendCtx): void {
  const { rai, routes } = ctx;
  const router = Router();
  const users = new UsersController(ctx);

  router.get("/", rai({
      id: "users:read",
      name: "List users",
      description: "Page through accounts, clamped by the shared bounds",
      // Validated on the way in, and described on the way out: one
      // declaration, so the spec cannot drift from what is enforced.
      query: listQuery,
      returns: z.array(userShape),
    }), users.list());

  router.delete("/:email", rai({
      id: "users:delete",
      name: "Soft-delete a user",
      description: "Flags the account; ordinary queries stop returning it",
      params: emailParam,
    }), users.softDelete());

  router.get("/deleted", rai({
      id: "users:read-deleted",
      name: "List soft-deleted users",
    }), users.listDeleted());

  router.post("/", rai({
      id: "users:create",
      status: 201,
      name: "Create a user",
      description: "Adds the account and queues its welcome email",
      body: createBody,
    }), users.create());

  router.get("/ping", rai({
      id: "users:ping",
      name: "Users module status",
    }), users.ping());

  router.get("/missing", rai({
      id: "users:demo-missing",
      name: "HttpError demo",
    }), users.demoMissing());

  router.get("/boom", rai({
      id: "users:demo-boom",
      name: "Unhandled error demo",
    }), users.demoBoom());

  // Deliberately outside the API prefix, to show a mount of its own.
  routes.mount(router, "/users");
}
