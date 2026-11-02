import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { BackendCtx } from "@tulipes/core/boot";
import { lazy, logger, type ClientHeaders } from "@app/core";

import { corsOptions, helmetOptions } from "../helpers/hardening.ts";
import { trustedProxies } from "../helpers/proxy.ts";
import { configuredRateLimits } from "../helpers/rate-limit.ts";

/**
 * Every piece here is configured from `ctx.config.security`, which is live:
 * helmet, CORS and the body parser are built on each request from the
 * current values (cheap, and a write lands at once), the proxy policy is
 * set here and again by module.config's onChange, and the rate limiter is
 * rebuilt there, so the handlers below always delegate to the current set.
 * The logger reads the core module's environment values, which inspection
 * refuses, so it is built on its first request.
 */
export default function securityRoutes(ctx: BackendCtx): void {
  const { app, config } = ctx;
  const prefix = String(config.api?.prefix ?? "");
  const security = () => config.security!;

  app.set("trust proxy", trustedProxies(security().trustProxyCidrs));
  app.use((req, res, next) => helmet(helmetOptions(security()))(req, res, next));
  app.use((req, res, next) => cors(corsOptions(security()))(req, res, next));
  app.use(lazy(() => pinoHttp({
    logger: logger(ctx),
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
    genReqId: (_req, res) => String(res.getHeader("X-Request-Id") ?? ""),
    serializers: {
      // What the client said about itself (req.client, bound by the core
      // module) travels with the line, so a file can be filtered by platform
      // or app version; the request id is already the line's reqId.
      req: (req: { method: string; url: string; raw: { client?: Partial<ClientHeaders> } }) => {
        const { platform, appVersion, appMode, deviceId } = req.raw.client ?? {};
        return { method: req.method, url: req.url, platform, appVersion, appMode, deviceId };
      },
      res: (res: { statusCode: number }) => ({ status: res.statusCode }),
    },
  })));
  app.use(`${prefix}/auth`, (req, res, next) => configuredRateLimits(ctx).auth(req, res, next));
  app.use([`${prefix}/config`, `${prefix}/settings`], (req, res, next) => configuredRateLimits(ctx).config(req, res, next));
  app.use((req, res, next) => express.json({ limit: security().bodyLimit })(req, res, next));
}
