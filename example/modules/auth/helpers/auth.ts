import type { Request } from "express";
import { ANONYMOUS, type Auth } from "@tulipes/core/http";

import type { SessionDoc, UserDoc } from "./documents.ts";

/**
 * Core owns the `Auth` shape and reads `req.auth`; this module's only job
 * is putting one there. That is the whole contract between an auth
 * implementation and the framework — swap JWT for sessions or mTLS and
 * nothing else changes.
 *
 * Core declares `user` and `session` as empty interfaces on purpose: it
 * knows the shape of the contract, and the app says what fills it. These
 * augmentations are what make `req.auth.user.email` and
 * `req.auth.session.last_seen_at` typed at every call site.
 */
declare module "@tulipes/core/http" {
  interface AuthUser extends UserDoc {}

  interface AuthSession extends SessionDoc {
    /**
     * This request's ACCESS token, added to the session row rather than
     * stored on it: the row outlives any single token, and these three
     * are what let a handler revoke exactly the token in its hand.
     */
    access_jti: string;
    access_issued_at: Date;
    access_expires_at: Date;
  }
}

export type { Auth };
export { ANONYMOUS as GUEST };

/**
 * Never undefined inside a declared route: the auth middleware sets it,
 * and `rai()` falls back to the guest value. This helper exists for code
 * that runs BEFORE any rai() — middleware in another sys module.
 */
export function auth(req: Request): Auth {
  if (!req.auth || req.auth === ANONYMOUS) req.auth = { ...ANONYMOUS };
  return req.auth;
}

/** The signed-in user, or undefined for a guest. Saves an `if` at call sites. */
export function currentUser(req: Request) {
  return auth(req).user ?? undefined;
}
