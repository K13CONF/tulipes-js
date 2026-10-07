import type { Express, Router, Request, RequestHandler, Response } from "express";

import { HttpError, ValidationError, type FieldIssue } from "./error-handler.ts";
import { codeOfIssue, fieldOf, type RouteSchemas, type ValidatableSchema } from "./schema.ts";
import type { Auth } from "./index.ts";
import { routePath } from "./paths.ts";

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
export interface RouteInfo extends RouteSchemas {
  /** Default success HTTP status for res.respond and generated documentation. */
  status?: number;
  /** Resource Access Identifier, e.g. "users:read". Also the permission. */
  id: string;
  /** Human label, for generated documentation. */
  name?: string;
  description?: string;
  /**
   * Groups this endpoint in generated specs — a folder in a Postman
   * collection, a tag in OpenAPI. Defaults to the declaring module, so
   * grouping comes out right without anyone saying anything; set it to
   * gather routes from several modules under one heading, or to split one
   * module's routes apart.
   */
  folder?: string;
  /**
   * The success payload — what goes in the envelope's `data`. Never
   * validated (a handler is trusted with its own output); it exists so a
   * generated spec can describe the response.
   */
  returns?: ValidatableSchema;
  /**
   * `false` keeps this endpoint out of the agent manifest. Every declared
   * route is a tool otherwise — see `@tulipes/core/agent`.
   */
  agent?: boolean;
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
export const MOUNT_PATH = Symbol.for("tulipes.mount-path");

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
 * Async decisions are awaited; only an explicit true grants access.
 */
export type AccessChecker = (req: Request, info: RouteInfo) => boolean | Promise<boolean>;

export class RouteRegistry {
  /** Set while a module's routes file runs, so declarations attribute to it. */
  currentModule = "(app)";
  #checker: AccessChecker | undefined;
  #records: RouteRecord[] = [];
  #app: Express | undefined;
  #prefix = "";

  /** @internal The backend branch binds the app and the configured prefix before any routes file runs. */
  bind_(app: Express, prefix: string): void {
    this.#app = app;
    this.#prefix = prefix.replace(/\/$/, "");
  }

  /** Where a returned router lands: `config.api.prefix`, or the root. */
  get prefix(): string {
    return this.#prefix;
  }

  /**
   * Mount a router with its prefix preserved for inspection, including named
   * parameters. `mount(router)` mounts on the app under the configured
   * prefix, `mount(router, "/ops")` under another path, and
   * `mount(parent, "/tenants/:tenant", child)` nests one router in another.
   */
  mount(router: Router, path?: string): void;
  mount(parent: Express | Router, path: string, router: Router): void;
  mount(first: Express | Router, second?: string, third?: Router): void {
    const nested = third !== undefined;
    const parent = nested ? first : this.#app;
    const router = nested ? third : (first as Router);
    const path = nested ? second! : (second ?? this.#prefix);
    if (!parent) throw new Error("routes.mount(router) needs the HTTP app — call it from a routes file, in the backend branch");
    if (path !== "" && !routePath.test(path)) {
      throw new Error(`unsupported router mount "${path}" — use a literal path with named :parameters`);
    }
    (parent as Router).use(path || "/", router);
    const stack = "router" in parent
      ? (parent.router as { stack: object[] }).stack
      : (parent as Router & { stack: object[] }).stack;
    Object.defineProperty(stack.at(-1)!, MOUNT_PATH, { value: path.replace(/\/$/, "") });
  }

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
   * Binds per-request state: the i18n namespace (which depends on the
   * declaring module), req.page and res.respond. Runs before the access
   * check, so a refusal is phrased in the caller's language and the
   * envelope is available to build it.
   */
  bind?: (req: Request, res: Response, module: string) => void,
): (info: RouteInfo) => RequestHandler {
  return (info) => {
    const module = registry.currentModule;

    const handler: RequestHandler = async (req, res, next) => {
      req.rai = info;
      bind?.(req, res, module);

      // Guest state belongs to this request, including when middleware assigns
      // the exported fallback. Mutating it must not identify another caller.
      if (!req.auth || req.auth === ANONYMOUS) req.auth = { ...ANONYMOUS };

      const role = roleOf(req);
      const allowed = registry.checker
        ? await registry.checker(req, info)
        : can(role, info.id);

      if (allowed !== true) {
        // 401 says "sign in and this may work"; 403 says it will not. A
        // client can act on the difference, so they are not merged.
        //
        // Both carry a key AND an English default: an app that defines
        // "forbidden" in a module's i18n gets it translated, and one that
        // never thinks about it still reads correctly.
        throw req.auth.isAuthenticated
          ? new HttpError(403, "forbidden", {
              code: "FORBIDDEN",
              vars: { role, permission: info.id },
              defaultMessage: `role "${role}" may not ${info.id}`,
            })
          : new HttpError(401, "unauthenticated", {
              code: "UNAUTHENTICATED",
              defaultMessage: "authentication required",
            });
      }

      // Validation runs AFTER the access check, never before: telling a
      // caller which fields are wrong on a route they may not reach leaks
      // its shape to someone with no business knowing it.
      validate(req, info);
      return next();
    };

    const tag: RaiTag = { info, module };
    Object.defineProperty(handler, RAI_TAG, { value: tag, enumerable: false });
    return handler;
  };
}

/**
 * Parses every declared segment and writes the coerced values back, so a
 * handler reads `req.body.age` as the number the schema promised rather
 * than the string that arrived.
 *
 * All three segments are checked before throwing: a request wrong in the
 * query AND the body should say so once.
 */
function validate(req: Request, info: RouteInfo): void {
  const issues: FieldIssue[] = [];

  for (const segment of ["params", "query", "body"] as const) {
    const schema = info[segment];
    if (!schema) continue;

    const result = schema.safeParse(req[segment]);
    if (result.success) {
      assign(req, segment, result.data);
      continue;
    }

    for (const issue of result.error.issues) {
      issues.push({
        field: fieldOf(segment, issue.path),
        // Zod's message doubles as an i18n key when the schema names one:
        // `z.string().email("invalidEmail")` is translated downstream, and
        // a plain sentence passes through. The error handler decides.
        message: issue.message,
        ...(codeOfIssue(issue) && { code: codeOfIssue(issue)! }),
      });
    }
  }

  if (issues.length > 0) throw new ValidationError(issues);
}

/**
 * Express 5 exposes `req.query` through a getter, so it cannot be assigned
 * like the others — the coerced value is defined over it per request.
 */
function assign(req: Request, segment: "params" | "query" | "body", value: unknown): void {
  if (segment !== "query") {
    (req as unknown as Record<string, unknown>)[segment] = value;
    return;
  }
  Object.defineProperty(req, "query", { value, writable: true, configurable: true });
}
