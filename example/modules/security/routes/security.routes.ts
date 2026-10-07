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
 * Every piece here is configured from the environment, which inspection
 * does not resolve, so each is built on its first request. Quotas run
 * before body parsing and Passport, using the configured proxy policy.
 */
export default function securityRoutes({ app, Environment, mode, config }: BackendCtx): void {
  const prefix = String(config.api?.prefix ?? "");

  app.use(lazy(() => {
    app.set("trust proxy", trustedProxies(String(Environment.get("TRUST_PROXY_CIDRS"))));
    return helmet(helmetOptions(Environment));
  }));
  app.use(lazy(() => cors(corsOptions(Environment))));
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
  app.use(`${prefix}/auth`, lazy(() => configuredRateLimits(Environment).auth));
  app.use(`${prefix}/settings`, lazy(() => configuredRateLimits(Environment).settings));
  app.use(lazy(() => express.json({ limit: String(Environment.get("BODY_LIMIT")) })));
}
