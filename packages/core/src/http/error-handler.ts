import type { ErrorRequestHandler, Request, RequestHandler } from "express";

import type { AppEnv } from "../env/environment.js";
import { envelope, type ApiError } from "./envelope.js";
import { markResponded } from "./respond.js";

/**
 * The error a route throws on purpose. Anything else reaching the error
 * handler is a bug and gets the anonymous-500 treatment.
 *
 * Express 5 forwards rejected async handlers to the error middleware
 * automatically, so `throw new HttpError(404, "notFound")` inside an async
 * route is the entire error-handling story a module needs.
 *
 * The message may be an i18n KEY or a finished string, and you do not have
 * to say which — the terminal handler translates it in the namespace the
 * route's RAI recorded, and a string that resolves to no key is used as
 * written. Both of these are correct:
 *
 *   throw new HttpError(404, "notFound");          // key, translated later
 *   throw new HttpError(404, req.t("notFound"));   // translated already
 *
 * The first is worth preferring: the key survives into `code` as
 * NOT_FOUND, whereas a pre-translated message has to be given one.
 */
export interface HttpErrorOptions {
  /** The offending input, when the error is about one. */
  field?: string;
  /** Overrides the code derived from the key or the status. */
  code?: string;
  /**
   * English to fall back on when the key has no translation. Supplying it
   * declares that `message` IS a key — which is how the framework's own
   * errors stay readable in an app that never translates them, while
   * remaining translatable in one that does.
   */
  defaultMessage?: string;
  /** Interpolation values for the key: `{{role}}` and friends. */
  vars?: Record<string, unknown>;
  /** Anything else worth returning; kept out of the envelope's contract. */
  details?: unknown;
}

export class HttpError extends Error {
  readonly status: number;
  readonly field?: string;
  readonly code?: string;
  readonly defaultMessage?: string;
  readonly vars?: Record<string, unknown>;
  readonly details?: unknown;

  constructor(status: number, message: string, options: HttpErrorOptions = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    if (options.field !== undefined) this.field = options.field;
    if (options.code !== undefined) this.code = options.code;
    if (options.defaultMessage !== undefined) this.defaultMessage = options.defaultMessage;
    if (options.vars !== undefined) this.vars = options.vars;
    if (options.details !== undefined) this.details = options.details;
  }
}

/**
 * Several field errors at once — a form the caller got wrong in four
 * places should say so in one response, not four round trips.
 *
 *   throw new ValidationError([
 *     { field: "email", message: "emailTaken" },
 *     { field: "age", message: "mustBeAdult" },
 *   ]);
 *
 * Each message is a key or a finished string, exactly like HttpError's.
 */
export interface FieldIssue {
  field: string | null;
  message: string;
  code?: string;
}

export class ValidationError extends Error {
  readonly status = 422;
  readonly issues: readonly FieldIssue[];

  constructor(issues: readonly FieldIssue[], message = "validation failed") {
    super(message);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

/** HTTP statuses that carry a well-known code, so the common cases read right. */
const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  422: "VALIDATION_FAILED",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_ERROR",
};

/** `session.notFound` → SESSION_NOT_FOUND; `emailTaken` → EMAIL_TAKEN. */
function codeFromKey(key: string): string {
  return key
    .replace(/[.\-\s]+/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase();
}

/**
 * Resolves one message into its translated text and its code.
 *
 * i18next returns the key unchanged when it knows no translation, which is
 * exactly the signal needed: a string that resolves to something else was
 * a key, and anything else is already the message the caller should read.
 */
interface Resolvable {
  message: string;
  code?: string;
  defaultMessage?: string;
  vars?: Record<string, unknown>;
}

function resolve(req: Request, error: Resolvable, status: number): {
  message: string;
  code: string;
} {
  const { message, defaultMessage, vars } = error;

  // Asked BEFORE translating, never after. Calling t() on a string that is
  // already finished prose would record that whole sentence as a missing
  // key, filling a translator's work list with English it must never
  // contain.
  const isKey = req.hasTranslation?.(message) ?? false;

  return {
    message: isKey
      ? (req.t(message, { ...vars }) as string)
      : (defaultMessage ?? message),
    // A defaultMessage declares intent: the author wrote a key, so the
    // code comes from it even when no locale defines it yet.
    code:
      error.code ??
      (isKey || defaultMessage !== undefined
        ? codeFromKey(message)
        : (STATUS_CODES[status] ?? `HTTP_${status}`)),
  };
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
    next(
      new HttpError(404, `no route for ${req.method} ${req.path}`, {
        code: "ROUTE_NOT_FOUND",
      }),
    );
  };
}

/**
 * The single, final error middleware — and the only place a failure
 * envelope is built, so every error in the app has one shape.
 *
 * Fail-closed on information leaks: unexpected errors expose no message,
 * no stack, nothing — except in development, where hiding them only slows
 * the developer down.
 */
export function errorHandler(appEnv: AppEnv): ErrorRequestHandler {
  const revealInternals = appEnv === "development" || appEnv === "test";

  return (error: unknown, req, res, _next) => {
    const fail = (status: number, errors: ApiError[]): void => {
      markResponded(res);
      res.status(status).json(envelope({ errors }, {}));
    };

    if (error instanceof ValidationError) {
      fail(
        error.status,
        error.issues.map((issue) => {
          const { message, code } = resolve(req, issue, error.status);
          return { field: issue.field, message, code };
        }),
      );
      return;
    }

    if (error instanceof HttpError) {
      const { message, code } = resolve(req, error, error.status);
      fail(error.status, [{ field: error.field ?? null, message, code }]);
      return;
    }

    // Express middleware signals client faults with a numeric status on the
    // error — a body over the parser's limit is 413, malformed JSON is 400.
    // Flattening those to 500 would blame the server for the caller's
    // mistake, so 4xx statuses are honored and their messages passed
    // through (they describe the request, never our internals).
    const status = clientErrorStatus(error);
    if (status !== undefined) {
      fail(status, [
        {
          field: null,
          message: (error as Error).message,
          code: STATUS_CODES[status] ?? `HTTP_${status}`,
        },
      ]);
      return;
    }

    console.error("[http] unhandled error:", error);
    fail(500, [
      {
        field: null,
        message: revealInternals
          ? `internal: ${(error as Error)?.message ?? String(error)}`
          : "internal server error",
        code: "INTERNAL_ERROR",
      },
    ]);
  };
}
