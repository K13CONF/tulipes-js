import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { defineRoutes } from "@tulipes/core/http";

export default defineRoutes(({ app, runtime }) => {
  const security = runtime(async ({ Environment, mode }) => {
    const { corsOptions, helmetOptions } = await import("../helpers/hardening.js");
    const { trustedProxies } = await import("../helpers/proxy.js");
    app.set("trust proxy", trustedProxies(String(Environment.get("TRUST_PROXY_CIDRS"))));
    const { logger } = await import("@app/core");
    return {
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
  // Header policy, CORS, logging and parsing retain their Express order.
  app.use(security(value => value.headers));
  app.use(security(value => value.cors));
  app.use(security(value => value.logging));
  app.use(security(value => value.json));
});
