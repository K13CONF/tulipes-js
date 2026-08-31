import { randomUUID } from "node:crypto";
import type { Ctx } from "@tulipes/core/boot";

import { appCache } from "../helpers/cache/index.js";

/**
 * Global middleware lives HERE: the core module is tier "sys", priority 0 —
 * the first router of the whole pipeline — so mounting on ctx.app puts this
 * ahead of everything, security's stack included. Request ids stamped here
 * are what security's pino logger picks up as its reqId.
 */
export default function coreRoutes({ app, Environment }: Ctx): void {
  const cache = appCache(Environment); // redis-backed here; memory without REDIS_URL

  app!.use(async (_req, res, next) => {
    res.setHeader("X-Request-Id", randomUUID());
    // Demo of app-owned lib/ glue: a read-through cached sample.
    const served = await cache.wrap("stats:served-sample", 10, async () => Date.now());
    res.setHeader("X-Stats-Sample", String(served));
    next();
  });
}
