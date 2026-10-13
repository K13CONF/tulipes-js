import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import type { BackendCtx } from "@tulipes/core/boot";

import { appCache } from "../helpers/cache/index.ts";
import { lazy } from "../helpers/lazy.ts";

/**
 * The sys core module loads first, so what it mounts on `ctx.app` runs on
 * every request of every later module: this is the global middleware slot.
 */
export default function coreRoutes(ctx: BackendCtx): void {
  // The cache client opens on first use; built on the first request so
  // inspection never touches Redis, nor reads the URL it would need.
  ctx.app.use(lazy(() => {
    const cache = appCache(ctx);
    return (async (_req, res, next) => {
      res.setHeader("X-Request-Id", randomUUID());
      const served = await cache.wrap("stats:served-sample", 10, async () => Date.now());
      res.setHeader("X-Stats-Sample", String(served));
      next();
    }) satisfies RequestHandler;
  }));
}
