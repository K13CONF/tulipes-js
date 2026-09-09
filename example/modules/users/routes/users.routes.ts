import { Router } from "express";
import { defineRoutes } from "@tulipes/core/http";
import { z } from "zod/v4";
import { createBody, emailParam, listQuery, userShape } from "../schemas.js";

export default defineRoutes(({ app, rai, routes, runtime }) => {
  const router = Router();
  const users = runtime(async ctx => {
    const { UsersController } = await import("../controllers/users.controllers.js");
    return new UsersController(ctx);
  });

  router.get("/", rai({
      id: "users:read",
      name: "List users",
      description: "Page through accounts, clamped by the shared bounds",
      // Validated on the way in, and described on the way out: one
      // declaration, so the spec cannot drift from what is enforced.
      query: listQuery,
      returns: z.array(userShape),
    }), users(value => value.list()));

  router.delete("/:email", rai({
      id: "users:delete",
      name: "Soft-delete a user",
      description: "Flags the account; ordinary queries stop returning it",
      params: emailParam,
    }), users(value => value.softDelete()));

  router.get("/deleted", rai({
      id: "users:read-deleted",
      name: "List soft-deleted users",
    }), users(value => value.listDeleted()));

  router.post("/", rai({
      id: "users:create",
      status: 201,
      name: "Create a user",
      description: "Adds the account and queues its welcome email",
      body: createBody,
    }), users(value => value.create()));

  router.get("/ping", rai({
      id: "users:ping",
      name: "Users module status",
    }), users(value => value.ping()));

  router.get("/missing", rai({
      id: "users:demo-missing",
      name: "HttpError demo",
    }), users(value => value.demoMissing()));

  router.get("/boom", rai({
      id: "users:demo-boom",
      name: "Unhandled error demo",
    }), users(value => value.demoBoom()));

  routes.mount(app, "/users", router);
});
