import type { RequestHandler } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";

import { principal } from "./principal.js";

/**
 * Guards other modules import from `@app/auth`.
 *
 * Both distinguish "you are not signed in" (401 — logging in would help)
 * from "you are signed in and still may not" (403 — it would not). A
 * client can act on that difference; a blanket 403 makes it guess.
 */

/** Requires any signed-in principal, without naming a permission. */
export function requireAuth(): RequestHandler {
  return (req, _res, next) => {
    if (!principal(req).authenticated) {
      throw new HttpError(401, "authentication required");
    }
    next();
  };
}

/**
 * Requires a permission, checked against the module ACL.
 *
 * Guests are subject to the same check as anyone else, which is what makes
 * a public route just a grant to `guest` rather than a special case.
 */
export function requirePermission(ctx: Ctx, permission: string): RequestHandler {
  return (req, _res, next) => {
    const who = principal(req);
    if (ctx.acl!.can(who.role, permission)) return next();

    throw who.authenticated
      ? new HttpError(403, `role "${who.role}" may not ${permission}`)
      : new HttpError(401, "authentication required");
  };
}
