import type { Request, RequestHandler } from "express";

import { HttpError } from "./error-handler.js";
import type { Auth } from "./index.js";

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

/** The role a caller has before anyone identifies them. */
export const GUEST_ROLE = "guest";

export const ANONYMOUS: Auth = { isAuthenticated: false, user: null, session: null };

/**
 * The ACL's input. Core reads the role THROUGH the user, so an app that
 * keeps roles elsewhere overrides the whole decision with
 * `ctx.routes.setAccessChecker()` rather than faking a user.
 */
export function roleOf(req: Request): string {
  // The framework's one assumption about an app's user model, kept to a
  // single cast: the ACL needs a role and the app said it lives here.
  const user = req.auth?.user as { role?: string } | null | undefined;
  return user?.role ?? GUEST_ROLE;
}

declare global {
  namespace Express {
    interface Request {
      /**
       * Who is calling: `{ isAuthenticated, user, session }`. Set by an
       * auth module; `rai()` falls back to the anonymous value, so inside
       * a declared route this is never undefined.
       */
      auth: Auth;
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
 * Decides whether the caller may perform a RAI. Replaceable for policies
 * the ACL cannot express — ownership, tenancy, time windows — and for apps
 * whose roles do not live on the user document.
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
  /**
   * Binds per-request state that depends on which module declared the
   * route — the i18n namespace. Runs before the access check so a refusal
   * can still be phrased in the caller's language.
   */
  bind?: (req: Request, module: string) => void,
): (info: RouteInfo) => RequestHandler {
  return (info) => {
    const module = registry.currentModule;

    const handler: RequestHandler = (req, _res, next) => {
      req.rai = info;
      bind?.(req, module);

      // An app with no auth module still gets a well-formed req.auth, so a
      // handler never has to ask whether the field is there.
      req.auth ??= ANONYMOUS;

      const role = roleOf(req);
      const allowed = registry.checker
        ? registry.checker(req, info)
        : can(role, info.id);
      if (allowed) return next();

      // 401 says "sign in and this may work"; 403 says it will not. A
      // client can act on the difference, so they are not merged.
      throw req.auth.isAuthenticated
        ? new HttpError(403, `role "${role}" may not ${info.id}`)
        : new HttpError(401, "authentication required");
    };

    const tag: RaiTag = { info, module };
    Object.defineProperty(handler, RAI_TAG, { value: tag, enumerable: false });
    return handler;
  };
}
