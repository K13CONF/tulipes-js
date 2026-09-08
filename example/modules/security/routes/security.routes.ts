import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { BackendCtx } from "@tulipes/core/boot";

import { corsOptions, helmetOptions } from "../helpers/hardening.js";
import { logger } from "@app/core";

/**
 * The app's request-hardening stack. Sys tier, so this mounts ahead of
 * every app-tier router — the framework core mounts no middleware of its
 * own; this module IS the pipeline's head.
 *
 * Order matters:
 *   helmet  — headers on every response, including errors and preflights
 *   cors    — must answer OPTIONS preflights before anything parses a body
 *   pino    — logs the request once the two above have had their say
 *   json    — parsing last, so a rejected origin never reaches the parser
 */
export default function securityRoutes(ctx: BackendCtx): void {
  const { app, Environment, config, mode } = ctx

  app!.use(helmet(helmetOptions(Environment)));
  app!.use(cors(corsOptions(Environment)));

  app!.use(
    pinoHttp({
      logger: logger(Environment, mode),
      // Without this a 500 is logged at info, so the errors-only log file
      // stays empty exactly when you need it.
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      // The core module (priority 0) stamps X-Request-Id before this runs —
      // reuse it so log lines and response headers tell one story.
      genReqId: (_req, res) => String(res.getHeader("X-Request-Id") ?? ""),
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
  // a memory-exhaustion invitation. Declared by this module, because it
  // varies per deployment: an upload-heavy API raises it without touching
  // code.
  app!.use(express.json({ limit: String(Environment.get("BODY_LIMIT")) }));
}
