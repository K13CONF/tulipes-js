import { Router } from "express";
import { defineRoutes } from "@tulipes/core/http";
import { apiPrefix } from "../../../config/routes.js";
import {
  localeParams,
  logQuery,
  rebootBody,
  revealQuery,
  translationsBody,
  variableName,
  variableValue,
} from "../schemas.js";

export default defineRoutes(({ app, rai, routes, runtime }) => {
  const router = Router();
  const settings = runtime(async (ctx) => {
    const { SettingsController } = await import(
      "../controllers/settings.controllers.js"
    );
    return new SettingsController(ctx);
  });

  router.get(
    "/modules",
    rai({
      id: "settings:read",
      name: "Describe every module",
      description:
        "Manifest, declared variables with their full spec and resolved source, config, i18n and routes",
      folder: "settings",
    }),
    settings((value) => value.modules()),
  );

  router.get(
    "/variables/:name",
    rai({
      id: "settings:variable-read",
      name: "Read one variable",
      description: "Add ?reveal=true to return a secret's value — audited",
      folder: "settings",
      params: variableName,
      query: revealQuery,
    }),
    settings((value) => value.variable()),
  );

  router.put(
    "/variables/:name",
    rai({
      id: "settings:variable-write",
      name: "Set a variable",
      description: "Writes .envs/.env.<APP_ENV>; takes effect on the next boot",
      folder: "settings",
      params: variableName,
      body: variableValue,
    }),
    settings((value) => value.setVariable()),
  );

  router.get(
    "/i18n/:module/:locale",
    rai({
      id: "settings:i18n-read",
      name: "Read a module's translations",
      folder: "settings",
      params: localeParams,
    }),
    settings((value) => value.translations()),
  );

  router.put(
    "/i18n/:module/:locale",
    rai({
      id: "settings:i18n-write",
      name: "Replace a module's translations",
      description:
        "New keys are accepted — filling the recorded gaps is the point",
      folder: "settings",
      params: localeParams,
      body: translationsBody,
    }),
    settings((value) => value.setTranslations()),
  );

  router.post(
    "/reboot",
    rai({
      id: "settings:reboot",
      status: 202,
      name: "Restart the app",
      description:
        "Accepts verified targets; restarts begin after the response is written. Requires PM2",
      folder: "settings",
      body: rebootBody,
    }),
    settings((value) => value.reboot()),
  );

  router.get(
    "/logs/stream",
    rai({
      id: "settings:logs",
      name: "Stream logs",
      description: "Server-Sent Events over the log files — backend or worker",
      folder: "settings",
      query: logQuery,
    }),
    settings((value) => value.logStream()),
  );

  routes.mount(app, `${apiPrefix}/settings`, router);
});
