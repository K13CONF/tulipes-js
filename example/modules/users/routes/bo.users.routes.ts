import { Router } from "express";
import type { BackendCtx } from "@tulipes/core/boot";
import { listQuery } from "@app/core";

import { BoUsersController } from "../controllers/bo.users.controllers.ts";
import { createBody, emailParam } from "../schemas/users.schemas.ts";

/**
 * The users back office: every id is users:bo:…, so `users:bo:*` grants
 * all of it and `tulipes routes --scope bo` lists it. Mounted under /users
 * like the web routes beside it.
 */
export default function boUsersRoutes(ctx: BackendCtx): void {
  const { rai, routes } = ctx;
  const router = Router();
  const users = new BoUsersController(ctx);

  router.post("/", rai({
      id: "users:bo:create",
      status: 201,
      name: "Create a user",
      description: "Adds the account and queues its welcome email",
      body: createBody,
    }), users.create());

  // The list-query language: everything a client may search, filter, sort,
  // project, resolve or group on is named here, and nothing else gets through.
  router.get("/directory", rai({
      id: "users:bo:list",
      name: "Browse users",
      description: "Search, filter, sort, group and resolve sessions, within the declared policy",
      query: listQuery({
        search: ["email"],
        filter: {
          role: ["=", "!=", "in"],
          email: ["=", "like", "starts"],
          created_at: { type: "date", ops: [">", ">=", "<", "<="] },
        },
        sort: ["created_at", "email", "role"],
        fields: ["email", "role", "created_at"],
        resolve: {
          sessions: { fields: ["ip", "user_agent", "last_seen_at", "created_at"], sort: ["created_at", "last_seen_at"], maxLimit: 10 },
        },
        group: ["role"],
      }),
    }), users.list());

  router.get("/deleted", rai({
      id: "users:bo:list:deleted",
      name: "List soft-deleted users",
    }), users.listDeleted());

  router.delete("/:email", rai({
      id: "users:bo:delete",
      name: "Soft-delete a user",
      description: "Flags the account; ordinary queries stop returning it",
      params: emailParam,
    }), users.softDelete());

  // Deliberately outside the API prefix, to show a mount of its own.
  routes.mount(router, "/users");
}
