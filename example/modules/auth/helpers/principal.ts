import type { Request } from "express";
import { ANONYMOUS, type Principal } from "@tulipes/core/http";

/**
 * Core owns the Principal shape and reads `req.principal`; this module's
 * only job is putting one there. That is the whole contract between an
 * auth implementation and the framework — swap JWT for sessions or mTLS
 * and nothing else changes.
 *
 * The jti is this module's addition, not core's: it identifies the access
 * token so logout can revoke exactly this session. Added by augmentation,
 * the same way plugins extend RouteInfo.
 */
declare module "@tulipes/core/http" {
  interface Principal {
    /** jti of the access token behind this request. */
    jti?: string;
  }
}

export type { Principal };
export { ANONYMOUS as GUEST };

/** Never undefined: the middleware assigns the anonymous principal. */
export function principal(req: Request): Principal {
  return req.principal ?? ANONYMOUS;
}
