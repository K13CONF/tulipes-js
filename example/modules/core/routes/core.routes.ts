import type { RequestHandler } from "express";
import type { BackendCtx } from "@tulipes/core/boot";

import { appCache } from "../helpers/cache/index.ts";
import { clientHeaders } from "../helpers/client-headers.ts";
import { lazy } from "../helpers/lazy.ts";

/**
 * The sys core module loads first, so what it mounts on `ctx.app` runs on
 * every request of every later module: this is the global middleware slot.
 */
export default function coreRoutes(ctx: BackendCtx): void {
  // Who is calling: req.client, and X-Request-Id echoed so the security
  // module's log line and the client's error toast show the same id.
  ctx.app.use(clientHeaders());

  // The cache client opens on first use; built on the first request so
  // inspection never touches Redis, nor reads the URL it would need.
  ctx.app.use(lazy(() => {
    const cache = appCache(ctx);
    return (async (_req, res, next) => {
      const served = await cache.wrap("stats:served-sample", 10, async () => Date.now());
      res.setHeader("X-Stats-Sample", String(served));
      next();
    }) satisfies RequestHandler;
  }));
}
