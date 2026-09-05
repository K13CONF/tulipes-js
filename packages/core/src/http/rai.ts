import type { Request, RequestHandler } from "express";

import { HttpError } from "./error-handler.js";
import type { Principal } from "./index.js";

/**
 * RAI — Resource Access Identifier.
 *
 * `id` names a resource and an access to it ("users:read"), which is also
 * the ACL permission. One declaration therefore does three jobs: it
 * identifies the endpoint, gates it, and marks the route as declared so
 * the boot scan can prove no endpoint was left unguarded.
 *
 * Plugins extend this interface by augmentation — the same pattern as
 * KnownVariables and GlobalConfig — so their fields are typed at the call
 * site rather than hidden in an untyped bag:
 *
 *   declare module "@tulipes/core/http" {
 *     interface RouteInfo { openapi?: { tags: string[] } }
 *   }
 */
export interface RouteInfo {
  /** Resource Access Identifier, e.g. "users:read". Also the permission. */
  id: string;
  /** Human label, for generated documentation. */
  name?: string;
  description?: string;
}

export const ANONYMOUS: Principal = { role: "guest", authenticated: false };

declare global {
  namespace Express {
    interface Request {
      /** Set by an auth module; absent means anonymous. */
      principal?: Principal;
      /** The matched route's declaration, set before its handler runs. */
      rai?: RouteInfo;
    }
  }
}

/** Marks a handler as a route declaration. Symbol.for so it survives duplicate module instances. */
export const RAI_TAG = Symbol.for("tulipes.rai");

export interface RaiTag {
  info: RouteInfo;
  module: string;
}

/** One declared endpoint, as the boot scan found it. */
export interface RouteRecord extends RaiTag {
  method: string;
  path: string;
}

/**
 * Decides whether a principal may perform a RAI. Replaceable for policies
 * the ACL cannot express — ownership, tenancy, time windows.
 */
export type AccessChecker = (req: Request, info: RouteInfo) => boolean;

export class RouteRegistry {
  /** Set while a module's routes file runs, so declarations attribute to it. */
  currentModule = "(app)";
  #checker: AccessChecker | undefined;
  #records: RouteRecord[] = [];

  /** Override the default role-versus-ACL check. */
  setAccessChecker(checker: AccessChecker): void {
    this.#checker = checker;
  }

  get checker(): AccessChecker | undefined {
    return this.#checker;
  }

  /** @internal Filled by the boot scan, which is where method and path come from. */
  record_(records: RouteRecord[]): void {
    this.#records = records;
  }

  all(): readonly RouteRecord[] {
    return this.#records;
  }

  find(id: string): RouteRecord | undefined {
    return this.#records.find((record) => record.info.id === id);
  }
}

/**
 * Builds the middleware a route puts first. Exposed as `ctx.rai` so a
 * routes file can destructure it and never import anything:
 *
 *   export default function usersRoutes({ rai }: Ctx) {
 *     router.get(path, rai({ id: "users:read", name: "List users" }), handler);
 *   }
 */
export function createRai(
  registry: RouteRegistry,
  can: (role: string, permission: string) => boolean,
): (info: RouteInfo) => RequestHandler {
  return (info) => {
    const handler: RequestHandler = (req, _res, next) => {
      req.rai = info;

      const who = req.principal ?? ANONYMOUS;
      const allowed = registry.checker
        ? registry.checker(req, info)
        : can(who.role, info.id);
      if (allowed) return next();

      // 401 says "sign in and this may work"; 403 says it will not. A
      // client can act on the difference, so they are not merged.
      throw who.authenticated
        ? new HttpError(403, `role "${who.role}" may not ${info.id}`)
        : new HttpError(401, "authentication required");
    };

    const tag: RaiTag = { info, module: registry.currentModule };
    Object.defineProperty(handler, RAI_TAG, { value: tag, enumerable: false });
    return handler;
  };
}
