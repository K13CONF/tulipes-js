import type { RequestHandler } from "express";

/**
 * Middleware built on its first request rather than while the routes
 * file runs. Inspection (`tulipes routes`, `tulipes spec`) builds every
 * router without resolving the environment or acquiring a service, so a
 * middleware that reads a variable or opens a client is built here, once,
 * when a real request arrives.
 */
export function lazy(build: () => RequestHandler): RequestHandler {
  let handler: RequestHandler | undefined;
  return (req, res, next) => (handler ??= build())(req, res, next);
}
