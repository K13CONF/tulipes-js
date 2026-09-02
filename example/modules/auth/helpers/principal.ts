import type { Request } from "express";

/**
 * Who is making this request.
 *
 * There is always one — a request with no valid token is the `guest`
 * principal rather than an absent user. That is what lets a public
 * endpoint be an ordinary ACL grant (`allow("guest", "auth:login")`)
 * instead of a second, parallel allowlist mechanism.
 */
export interface Principal {
  id?: string;
  email?: string;
  role: string;
  /** jti of the access token, so logout can revoke this exact session. */
  jti?: string;
  authenticated: boolean;
}

export const GUEST: Principal = { role: "guest", authenticated: false };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal: Principal;
    }
  }
}

/** Never undefined: middleware assigns GUEST before any route runs. */
export function principal(req: Request): Principal {
  return req.principal ?? GUEST;
}
