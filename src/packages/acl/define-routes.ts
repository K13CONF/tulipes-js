import type { NextFunction, Request, RequestHandler, Response } from "express"
import type { RouteParameters } from "express-serve-static-core"
import type { ZodType } from "zod"
import type { ACL, RAI } from "./types.js"

/** HTTP methods a route can be bound to. */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH"

/**
 * A fully-described route collected by the registry, ready to be mounted on an
 * Express router by the application as `router[method](path, ...middlewares, handler)`.
 */
export interface RouteRecord {
    rai: RAI
    method: HttpMethod
    path: string
    middlewares: RequestHandler[]
    handler?: RequestHandler
}

/** Type for a standalone middleware compatible with `.use()` after `.validate()`. */
export type RouteMiddleware<
    Params = Record<string, string>,
    Body = unknown,
    Query = unknown,
> = RequestHandler<Params, any, Body, Query>

/** Type for a standalone terminal handler compatible with `.handle()` after `.validate()`. */
export type RouteHandler<
    Params = Record<string, string>,
    Body = unknown,
    Query = unknown,
> = (req: Request<Params, any, Body, Query>, res: Response, next: NextFunction) => unknown

/** Per-segment zod schemas accepted by `.validate()`. */
export interface ValidationSchemas {
    params?: ZodType
    query?: ZodType
    body?: ZodType
}

/** Validated (coerced) output type of a schema, or a fallback when it's absent. */
type InferOr<Schema, Fallback> = Schema extends ZodType<infer Output> ? Output : Fallback

/**
 * Builds the strongly-typed `defineRoutes` function for a module, bound to that
 * module's RAIs (`Identifier`). The `acl` value drives a runtime check that
 * every `require(...)` references a granted RAI.
 */
export default function defineRoutesFactory<Identifier extends string>(acl: ACL) {
    const grantedRAIs = new Set<string>()
    for (const permissions of Object.values(acl)) {
        permissions?.forEach((permission) => grantedRAIs.add(permission))
    }

    return function defineRoutes(
        callback: (registry: RoutesRegistry<Identifier>) => void,
    ): RouteRecord[] {
        const registry = new RoutesRegistry<Identifier>(grantedRAIs)
        callback(registry)
        return registry.routes
    }
}

/**
 * Collects route definitions for a module. `require(rai)` is typed with the
 * module's RAIs, so the identifier autocompletes and unknown ones are rejected.
 */
export class RoutesRegistry<Identifier extends string> {
    private _directRoutes: RouteRecord[] = []
    private _groups: Array<{ finalize(): RouteRecord[] }> = []

    constructor(private readonly grantedRAIs: Set<string>) {}

    /** All collected routes: direct routes followed by finalized prefix groups. */
    get routes(): RouteRecord[] {
        return [...this._directRoutes, ...this._groups.flatMap((g) => g.finalize())]
    }

    public require(rai: Identifier) {
        // Types already guarantee this; the runtime guard protects untyped callers.
        if (!this.grantedRAIs.has(rai)) {
            throw new Error(`RAI "${rai}" is not granted to any role in this module's ACL`)
        }

        const bind = <Path extends string>(method: HttpMethod, path: Path) => {
            const record: RouteRecord = { rai, method, path, middlewares: [] }
            this._directRoutes.push(record)
            return new RouteBuilder<RouteParameters<Path>>(record)
        }

        return {
            get: <Path extends string>(path: Path) => bind("GET", path),
            post: <Path extends string>(path: Path) => bind("POST", path),
            put: <Path extends string>(path: Path) => bind("PUT", path),
            delete: <Path extends string>(path: Path) => bind("DELETE", path),
            patch: <Path extends string>(path: Path) => bind("PATCH", path),
        }
    }

    /**
     * Groups routes under a shared path prefix. Every route defined through the
     * returned builder gets the prefix prepended to its path.
     *
     * The returned builder also exposes:
     * - `.use(middleware)` — runs before every route in this group
     * - `.param(name, middleware)` — runs before every route in this group whose
     *   path contains `:name` (mirrors Express `router.param()` semantics)
     */
    public prefix<Prefix extends string>(path: Prefix): RouteGroupBuilder<Identifier, Prefix> {
        const group = new RouteGroupBuilder<Identifier, Prefix>(path, this.grantedRAIs)
        this._groups.push(group)
        return group
    }
}

/**
 * Collects routes under a shared prefix. Prefix-level `.use()` middlewares and
 * `.param()` handlers are prepended to each route's middleware stack at finalize
 * time — no changes are needed to the mount layer.
 */
export class RouteGroupBuilder<Identifier extends string, Prefix extends string> {
    private readonly _routes: RouteRecord[] = []
    private readonly _middlewares: RequestHandler[] = []
    private readonly _params = new Map<string, RequestHandler>()

    constructor(
        private readonly prefix: Prefix,
        private readonly grantedRAIs: Set<string>,
    ) {}

    /**
     * Append a middleware that runs before every route in this group.
     * `req.params` is typed to the params declared in the prefix path.
     */
    public use(handler: RequestHandler<RouteParameters<Prefix>, any, unknown, unknown>): this {
        this._middlewares.push(handler as RequestHandler)
        return this
    }

    /**
     * Register a param pre-handler for every route in this group whose path
     * contains `:name`. `Name` is constrained to params declared in the prefix,
     * so referencing an undeclared param is a compile-time error.
     */
    public param<Name extends keyof RouteParameters<Prefix> & string>(
        name: Name,
        handler: RequestHandler<RouteParameters<Prefix>, any, unknown, unknown>,
    ): this {
        this._params.set(name, handler as RequestHandler)
        return this
    }

    /** Same fluent API as `RoutesRegistry.require()`, with the prefix prepended to every path. */
    public require(rai: Identifier) {
        if (!this.grantedRAIs.has(rai)) {
            throw new Error(`RAI "${rai}" is not granted to any role in this module's ACL`)
        }

        const bind = <RoutePath extends string>(method: HttpMethod, routePath: RoutePath) => {
            type FullPath = `${Prefix}${RoutePath}`
            const fullPath = `${this.prefix}${routePath}` as FullPath
            const record: RouteRecord = { rai, method, path: fullPath, middlewares: [] }
            this._routes.push(record)
            return new RouteBuilder<RouteParameters<FullPath>>(record)
        }

        return {
            get: <RoutePath extends string>(routePath: RoutePath) => bind("GET", routePath),
            post: <RoutePath extends string>(routePath: RoutePath) => bind("POST", routePath),
            put: <RoutePath extends string>(routePath: RoutePath) => bind("PUT", routePath),
            delete: <RoutePath extends string>(routePath: RoutePath) => bind("DELETE", routePath),
            patch: <RoutePath extends string>(routePath: RoutePath) => bind("PATCH", routePath),
        }
    }

    /**
     * Resolves the final middleware stack for every route in the group.
     * Order: param handlers → prefix `.use()` middlewares → route's own middlewares.
     * Called once by `RoutesRegistry.routes` at the end of `defineRoutes`.
     */
    finalize(): RouteRecord[] {
        return this._routes.map((route) => {
            const paramNames = [...route.path.matchAll(/:(\w+)/g)].map((m) => m[1]).filter((n): n is string => n !== undefined)
            const paramMiddlewares = paramNames
                .filter((name) => this._params.has(name))
                .map((name) => this._params.get(name)!)
            return {
                ...route,
                middlewares: [...paramMiddlewares, ...this._middlewares, ...route.middlewares],
            }
        })
    }
}

/**
 * Fluent builder for a single route. The generics carry the typed request
 * shape: `Params` (from the path, refined by `validate.params`), `Body`, and
 * `Query`, so every `.use`/`.handle` gets a correctly-typed `req`.
 */
export class RouteBuilder<Params, Body = unknown, Query = unknown> {
    constructor(private readonly record: RouteRecord) {}

    /**
     * Validate (and coerce) request segments with zod. The parsed output types
     * flow into `req.params`/`req.body`/`req.query` for all following handlers.
     * On failure the zod error is forwarded via `next(error)`.
     */
    public validate<Schemas extends ValidationSchemas>(
        schemas: Schemas,
    ): RouteBuilder<
        InferOr<Schemas["params"], Params>,
        InferOr<Schemas["body"], Body>,
        InferOr<Schemas["query"], Query>
    > {
        this.record.middlewares.push(createValidationMiddleware(schemas))
        return this as unknown as RouteBuilder<
            InferOr<Schemas["params"], Params>,
            InferOr<Schemas["body"], Body>,
            InferOr<Schemas["query"], Query>
        >
    }

    /** Append a middleware (full `(req, res, next)`). Chainable. */
    public use(handler: RequestHandler<Params, any, Body, Query>): this {
        this.record.middlewares.push(handler as RequestHandler)
        return this
    }

    /** Terminal request handler that responds. Ends the chain. */
    public handle(
        handler: (req: Request<Params, any, Body, Query>, res: Response, next: NextFunction) => unknown,
    ): RouteRecord {
        this.record.handler = handler as RequestHandler
        return this.record
    }
}

/** Creates the middleware that parses each provided segment and coerces `req`. */
function createValidationMiddleware(schemas: ValidationSchemas): RequestHandler {
    return (req, _res, next) => {
        try {
            if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params
            if (schemas.body) req.body = schemas.body.parse(req.body)
            if (schemas.query) {
                // Express 5 exposes `req.query` through a getter, so it can't be
                // reassigned directly — override it per-request instead.
                const parsedQuery = schemas.query.parse(req.query)
                Object.defineProperty(req, "query", {
                    value: parsedQuery,
                    writable: true,
                    configurable: true,
                })
            }
            next()
        } catch (error) {
            next(error)
        }
    }
}
