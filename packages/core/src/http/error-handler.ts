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

/**
 * A 4xx carried on a non-HttpError (express, body-parser, multer…), or
 * undefined when the error is ours to own as a 500.
 */
function clientErrorStatus(error: unknown): number | undefined {
  const candidate = (error as { status?: unknown; statusCode?: unknown } | null)
    ?.status ?? (error as { statusCode?: unknown } | null)?.statusCode;

  return typeof candidate === "number" && candidate >= 400 && candidate <= 499
    ? candidate
    : undefined;
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

    // Express middleware signals client faults with a numeric status on the
    // error — a body over the parser's limit is 413, malformed JSON is 400.
    // Flattening those to 500 would blame the server for the caller's
    // mistake, so 4xx statuses are honored and their messages passed
    // through (they describe the request, never our internals).
    const status = clientErrorStatus(error);
    if (status !== undefined) {
      res.status(status).json({ error: (error as Error).message });
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
