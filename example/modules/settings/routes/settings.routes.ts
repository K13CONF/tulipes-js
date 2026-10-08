import { Router } from "express";
import type { BackendCtx } from "@tulipes/core/boot";

import { SettingsController } from "../controllers/settings.controllers.ts";
import { logQuery } from "../schemas/settings.schemas.ts";

/**
 * One endpoint: the log stream. Everything the console used to do here —
 * describing modules, editing variables and translations, restarting —
 * is either a setting now (the `config` module edits those, hot, with a
 * version and an audit) or code in the repository.
 */
export default function settingsRoutes(ctx: BackendCtx): void {
  const { rai, routes, config } = ctx;
  const router = Router();
  const settings = new SettingsController(ctx);

  router.get(
    "/logs/stream",
    rai({
      id: "settings:logs",
      name: "Stream logs",
      description: "Server-Sent Events over the log files — backend or worker",
      folder: "settings",
      query: logQuery,
      // A stream is not a tool: it never ends on its own.
    }),
    settings.logStream(),
  );

  routes.mount(router, `${config.api!.prefix}/settings`);
}
