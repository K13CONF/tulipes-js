import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { BackendCtx } from "@tulipes/core/boot";
import { lazy, logger } from "@app/core";

import { corsOptions, helmetOptions } from "../helpers/hardening.js";
import { trustedProxies } from "../helpers/proxy.js";
import { configuredRateLimits } from "../helpers/rate-limit.js";

/**
 * Every piece here is configured from `ctx.config.security`, which is live:
 * helmet, CORS and the body parser are built on each request from the
 * current values (cheap, and a write lands at once), the proxy policy is
 * set here and again by module.config's onChange, and the rate limiter is
 * rebuilt there, so the handlers below always delegate to the current set.
 * The logger reads the environment, which inspection does not resolve, so
 * it is built on its first request.
 */
export default function securityRoutes(ctx: BackendCtx): void {
  const { app, Environment, mode, config } = ctx;
  const prefix = String(config.api?.prefix ?? "");
  const security = () => config.security!;

  app.set("trust proxy", trustedProxies(security().trustProxyCidrs));
  app.use((req, res, next) => helmet(helmetOptions(security()))(req, res, next));
  app.use((req, res, next) => cors(corsOptions(security()))(req, res, next));
  app.use(lazy(() => pinoHttp({
    logger: logger(Environment, mode),
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
    genReqId: (_req, res) => String(res.getHeader("X-Request-Id") ?? ""),
    serializers: {
      req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
      res: (res: { statusCode: number }) => ({ status: res.statusCode }),
    },
  })));
  app.use(`${prefix}/auth`, (req, res, next) => configuredRateLimits(ctx).auth(req, res, next));
  app.use([`${prefix}/config`, `${prefix}/settings`], (req, res, next) => configuredRateLimits(ctx).config(req, res, next));
  app.use((req, res, next) => express.json({ limit: security().bodyLimit })(req, res, next));
}
