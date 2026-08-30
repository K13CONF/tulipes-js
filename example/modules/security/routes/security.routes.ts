import express from "express";
import { pinoHttp } from "pino-http";
import type { Ctx } from "@tulipes/core/boot";

import { securityHeaders } from "../helpers/security-headers.js";
import { logger } from "../helpers/logger.js";

/**
 * The app's request-hardening stack. A sys-tier module, so this mounts
 * ahead of every app-tier router — core itself mounts no middleware, this
 * module IS the pipeline's head and stays in the developer's reach.
 *
 * Mounts directly on ctx.app (returns no Router): middleware here applies
 * to the whole app, not to a path prefix.
 */
export default function securityRoutes({ app, Environment, config }: Ctx): void {
  app!.use(securityHeaders());

  app!.use(
    pinoHttp({
      logger: logger(Environment),
      // The sys core module (priority 0) stamps X-Request-Id before this
      // runs — reuse it so log lines and response headers tell one story.
      genReqId: (_req, res) => String(res.getHeader("X-Request-Id") ?? ""),
      // Default serializers dump whole req/res objects; one lean line each.
      serializers: {
        req: (req: { method: string; url: string }) => ({
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ status: res.statusCode }),
      },
    }),
  );

  // Body-size cap is a security control too — a parser without a limit is
  // a memory-exhaustion invitation. Tuned from config/app.config.ts.
  app!.use(express.json({ limit: config.http?.bodyLimit ?? "1mb" }));
}
