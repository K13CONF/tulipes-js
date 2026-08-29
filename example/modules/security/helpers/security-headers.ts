import type { RequestHandler } from "express";

/**
 * Baseline hardening applied to every response before anything else runs.
 * Deliberately dependency-free — these few headers cover the API case;
 * swap in the full helmet suite here if this app ever needs it.
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
