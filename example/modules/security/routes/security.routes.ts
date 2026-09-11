import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { defineRoutes } from "@tulipes/core/http";
import { apiPrefix } from "../../../config/routes.js";

export default defineRoutes(({ app, runtime }) => {
  const security = runtime(async ({ Environment, mode }) => {
    const { corsOptions, helmetOptions } = await import("../helpers/hardening.js");
    const { trustedProxies } = await import("../helpers/proxy.js");
    app.set("trust proxy", trustedProxies(String(Environment.get("TRUST_PROXY_CIDRS"))));
    const { configuredRateLimits } = await import("../helpers/rate-limit.js");
    const limits = configuredRateLimits(Environment);
    const { logger } = await import("@app/core");
    return {
      limits,
      headers: helmet(helmetOptions(Environment)),
      cors: cors(corsOptions(Environment)),
      logging: pinoHttp({
        logger: logger(Environment, mode),
        customLogLevel: (_req, res, err) =>
          err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
        genReqId: (_req, res) => String(res.getHeader("X-Request-Id") ?? ""),
        serializers: {
          req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
          res: (res: { statusCode: number }) => ({ status: res.statusCode }),
        },
      }),
      json: express.json({ limit: String(Environment.get("BODY_LIMIT")) }),
    };
  });
  // Quotas run before body parsing and Passport, using the configured proxy policy.
  app.use(security(value => value.headers));
  app.use(security(value => value.cors));
  app.use(security(value => value.logging));
  app.use(`${apiPrefix}/auth`, security(value => value.limits.auth));
  app.use(`${apiPrefix}/settings`, security(value => value.limits.settings));
  app.use(security(value => value.json));
});
