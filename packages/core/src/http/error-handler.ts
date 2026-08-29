import type { ErrorRequestHandler, RequestHandler } from "express";

import type { AppEnv } from "../env/environment.js";

/**
 * The error a route throws on purpose. Anything else reaching the error
 * handler is a bug and gets the anonymous-500 treatment.
 *
 * Express 5 forwards rejected async handlers to the error middleware
 * automatically, so `throw new HttpError(404, "no such user")` inside an
 * async route is the entire error-handling story a module needs.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

/** Terminal 404 — anything no router claimed. */
export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => {
    next(new HttpError(404, `no route for ${req.method} ${req.path}`));
  };
}

/**
 * The single, final error middleware. Fail-closed on information leaks:
 * unexpected errors expose no message, no stack, nothing — except in
 * development, where hiding them only slows the developer down.
 */
export function errorHandler(appEnv: AppEnv): ErrorRequestHandler {
  const revealInternals = appEnv === "development" || appEnv === "test";

  return (error: unknown, _req, res, _next) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({
        error: error.message,
        ...(error.details !== undefined && { details: error.details }),
      });
      return;
    }

    console.error("[http] unhandled error:", error);
    res.status(500).json({
      error: revealInternals
        ? `internal: ${(error as Error)?.message ?? String(error)}`
        : "internal server error",
    });
  };
}
