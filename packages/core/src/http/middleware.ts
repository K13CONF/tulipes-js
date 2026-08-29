import type { RequestHandler } from "express";

/**
 * Baseline hardening applied to every response before anything else runs.
 * Deliberately dependency-free — these few headers cover the API case;
 * an app wanting the full helmet suite adds it in app.middleware.ts.
 */
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    // An API serves no active content; a restrictive CSP costs nothing
    // and defuses any HTML-ish response a bug might produce.
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    next();
  };
}

/** One line per request, logged when the response finishes. */
export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const startedAt = performance.now();
    res.on("finish", () => {
      const ms = (performance.now() - startedAt).toFixed(1);
      console.log(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
    });
    next();
  };
}
