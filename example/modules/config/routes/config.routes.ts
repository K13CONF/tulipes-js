import { Router } from "express";
import type { BackendCtx } from "@tulipes/core/boot";

import { ConfigController } from "../controllers/config.controllers.js";
import { changeBody, moduleParam } from "../schemas/config.schemas.js";

export default function configRoutes(ctx: BackendCtx): void {
  const { rai, routes, config } = ctx;
  const router = Router();
  const console = new ConfigController(ctx);

  router.get("/", rai({
      id: "config:read",
      name: "Describe the app",
      description: "Every module in load order: manifest, declared variables (names, types, sources; secrets never), settings with schema, live values and stored version, endpoints with the roles that reach them",
      folder: "config",
    }), console.app());

  router.get("/:module", rai({
      id: "config:describe",
      name: "Describe one module",
      description: "The same description for one module",
      folder: "config",
      params: moduleParam,
    }), console.module());

  router.patch("/:module", rai({
      id: "config:write",
      name: "Change a module's settings",
      description: "A patch over the stored values, validated by the module's schema; a stale version is refused; applied at once in every replica, except fields tagged restart, which apply on the next boot",
      folder: "config",
      params: moduleParam,
      body: changeBody,
    }), console.change());

  routes.mount(router, `${config.api!.prefix}/config`);
}
