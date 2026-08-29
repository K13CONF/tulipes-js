import { randomUUID } from "node:crypto";
import type { Ctx } from "@forgex/core/boot";
import { appCache } from "./lib/cache/index.js";

/**
 * The app's global middleware slots in the web pipeline:
 *
 *   core (headers, logging, json) → beforeRoutes → module routers
 *   → afterRoutes → 404 → error handler
 *
 * beforeRoutes is where cross-cutting request middleware belongs — auth
 * gates, CORS, rate limiting, request ids. afterRoutes is the rare slot for
 * things that must see requests no router claimed, before the 404 fires.
 */
export function beforeRoutes({ app, Environment }: Ctx): void {
  const cache = appCache(Environment); // redis-backed here; memory without REDIS_URL

  app!.use(async (_req, res, next) => {
    res.setHeader("X-Request-Id", randomUUID());
    // Demo of app-owned lib/ glue: a read-through cached sample.
    const served = await cache.wrap("stats:served-sample", 10, async () => Date.now());
    res.setHeader("X-Stats-Sample", String(served));
    next();
  });
}
