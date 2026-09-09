import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { defineRoutes } from "@tulipes/core/http";

export default defineRoutes(({ app, runtime }) => {
  const middleware = runtime(async ({ Environment }) => {
    const { appCache } = await import("../helpers/cache/index.js");
    const cache = appCache(Environment);
    return (async (_req, res, next) => {
      res.setHeader("X-Request-Id", randomUUID());
      const served = await cache.wrap("stats:served-sample", 10, async () => Date.now());
      res.setHeader("X-Stats-Sample", String(served));
      next();
    }) satisfies RequestHandler;
  });
  app.use(middleware(handler => handler));
});
