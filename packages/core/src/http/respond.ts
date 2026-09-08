import type { Request, Response } from "express";

import { buildMeta, envelope, type Envelope, type RespondOptions } from "./envelope.js";
import { parsePage, type PageRequest, type PaginationBounds } from "./pagination.js";

/**
 * `res.respond` is the app's own method, not a replacement for anything:
 * express's `res.json`, `res.send` and `res.status` behave exactly as they
 * always did. Nothing is patched, intercepted or rewritten.
 *
 *   res.respond({ data: user });
 *   res.respond({ data: user, status: 201 });
 *   res.respond({ data: users, meta: { total_items: total } });
 *   res.respond({ data: null, meta: { action: "complete_profile" } });
 *
 * Errors are thrown rather than responded — the terminal handler builds
 * the same envelope from an HttpError — so a handler on the happy path
 * only ever writes the happy path.
 */
declare global {
  namespace Express {
    interface Request {
      /** `?page` / `?per_page`, clamped by config.pagination. */
      page: PageRequest;
    }
    interface Response {
      respond<T>(options: RespondOptions<T>): Response;
    }
  }
}

export type { Envelope, RespondOptions, PageRequest };

/**
 * Binds `req.page` and `res.respond` for one request.
 *
 * Called from `rai()` rather than mounted as middleware, for the same
 * reason `req.t` and `req.auth` are: core mounts nothing globally, and a
 * declared route is exactly the scope where these make sense.
 */
export function bindRespond(req: Request, res: Response, bounds: PaginationBounds): void {
  req.page = parsePage(req, bounds);

  res.respond = function respond<T>(options: RespondOptions<T>): Response {
    const body: Envelope<T> = envelope(options, buildMeta(options.meta, req.page));
    const status = options.status ?? (body.success ? (req.rai?.status ?? 200) : 400);

    respondedTo.add(res);
    return this.status(status).json(body);
  };
}

/**
 * Responses that went through `res.respond`. A WeakSet so a finished
 * response is collectable the moment express drops it.
 */
const respondedTo = new WeakSet<Response>();

/**
 * Marks a response as enveloped without going through `res.respond`.
 *
 * The terminal error handler needs this: it builds the failure envelope
 * itself — `res.respond` may not even be bound, since errors can be
 * thrown before any route matched — and would otherwise trip the
 * development warning on every error it correctly handled.
 */
export function markResponded(res: Response): void {
  respondedTo.add(res);
}

/**
 * Development-only: notice a route that answered without `res.respond`,
 * and say which one.
 *
 * This observes; it does not intervene. Express keeps its exact behaviour
 * and the raw body still ships — the point is that the mistake is visible
 * the first time the route is hit, instead of reaching a client silently.
 * Never armed outside development, where the listener would be pure cost.
 */
export function warnOnRawResponse(req: Request, res: Response): void {
  res.on("finish", () => {
    if (respondedTo.has(res)) return;
    // 3xx and 304s legitimately carry no body, and a stream or a file
    // download is not an envelope's business either.
    if (res.statusCode < 200 || res.statusCode === 204 || res.statusCode === 304) return;
    if (!res.getHeader("content-type")?.toString().includes("json")) return;

    const id = req.rai?.id ?? "(undeclared)";
    console.warn(
      `[tulipes] ${id} ${req.method} ${req.originalUrl} answered without ` +
        "res.respond — body is not enveloped",
    );
  });
}
