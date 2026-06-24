import type { NextFunction, Request, RequestHandler, Response } from "express"
import type { ParamsDictionary, RouteParameters } from "express-serve-static-core"
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
    /** When true, mount at the bare path, outside the global API prefix (see `.root()`). */
    root?: boolean
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

/**
 * A param name accepted by `group.param()`: the params declared in the prefix
 * (autocompleted), plus any other `:param` a route in the group may introduce
 * (e.g. `.get("/:id")`). The `string & {}` arm keeps the literal autocomplete
 * while still allowing those route-level names.
 */
type ParamName<Prefix extends string> = (keyof RouteParameters<Prefix> & string) | (string & {})

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
 * Collects routes under a shared path prefix, and is itself a scope: it can open
 * further nested groups via `prefix(...)`. A route's final middleware stack is
 * assembled at {@link finalize} time by walking from the outermost scope inward:
 *
 *   group `use()` (outer → inner)  →  matched `param()` handlers  →  the route's
 *   own middlewares (`validate` / `use`)  →  the handler
 *
 * Nested groups inherit their ancestors' `use()` middlewares and `param()`
 * handlers; a `param()` redefined deeper overrides a shallower one of the same
 * name. Everything resolves to a plain `RouteRecord[]`, so the mount layer needs
 * no knowledge of groups.
 */
export class RouteGroupBuilder<Identifier extends string, Prefix extends string> {
    protected readonly _routes: RouteRecord[] = []
    protected readonly _children: RouteGroupBuilder<Identifier, any>[] = []
    protected readonly _middlewares: RequestHandler[] = []
    protected readonly _params = new Map<string, RequestHandler>()
    protected _isRoot = false

    constructor(
        protected readonly _prefix: Prefix,
        protected readonly grantedRAIs: Set<string>,
    ) {}

    /**
     * Append a middleware that runs before every route in this group (and its
     * nested groups). `req.params` is typed to the params declared in the prefix.
     */
    public use(handler: RequestHandler<RouteParameters<Prefix>, any, unknown, unknown>): this {
        this._middlewares.push(handler as RequestHandler)
        return this
    }

    /**
     * Register a param pre-handler for routes in this group (and its nested
     * groups) whose path declares `:name`. The name autocompletes the params
     * declared in the prefix, but also accepts one introduced by a route in the
     * group (e.g. `.get("/:id")`) — handlers are matched against each route's
     * full path, so the param need not live in the prefix. A registered name
     * that no route under this group declares is reported at startup (see
     * `finalize`), recovering the safety a strict type couldn't give here.
     */
    public param<Params = ParamsDictionary>(name: ParamName<Prefix>, handler: RouteMiddleware<Params>): this {
        this._params.set(name, handler as RequestHandler)
        return this
    }

    /**
     * Open a nested group whose prefix is this group's prefix followed by `path`.
     * The child inherits this group's `use()` middlewares and `param()` handlers.
     *
     * @example
     * const collection = registry.prefix("/categories")   // /categories
     * const item = collection.prefix("/:categoryId")       // /categories/:categoryId
     */
    public prefix<Sub extends string>(path: Sub): RouteGroupBuilder<Identifier, `${Prefix}${Sub}`> {
        const child = new RouteGroupBuilder<Identifier, `${Prefix}${Sub}`>(
            `${this._prefix}${path}`,
            this.grantedRAIs,
        )
        this._children.push(child)
        return child
    }

    /**
     * Mount every route in this group (and its nested groups) outside the global
     * API prefix — for a whole collection like `/webhooks/*`. Equivalent to
     * calling `.root()` on each of the group's routes. Chainable, order-independent.
     *
     * @example
     * const webhooks = registry.prefix("/webhooks").root()   // routes live at /webhooks/*
     */
    public root(): this {
        this._isRoot = true
        return this
    }

    /** Begin a route under this group's prefix, guarded by `rai`. */
    public require(rai: Identifier) {
        // Types already guarantee this; the runtime guard protects untyped callers.
        if (!this.grantedRAIs.has(rai)) {
            throw new Error(`RAI "${rai}" is not granted to any role in this module's ACL`)
        }

        const bind = <RoutePath extends string>(method: HttpMethod, routePath: RoutePath) => {
            type FullPath = `${Prefix}${RoutePath}`
            const fullPath = `${this._prefix}${routePath}` as FullPath
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
     * Flatten this group and its descendants into fully-resolved routes. Each
     * route's stack is `inherited + own use()`, then the `param()` handlers whose
     * name appears in its path (in path order, nearest definition winning), then
     * the route's own middlewares. Called once via `RoutesRegistry.routes`.
     */
    finalize(
        inheritedMiddlewares: readonly RequestHandler[] = [],
        inheritedParams: ReadonlyMap<string, RequestHandler> = new Map(),
        inheritedRoot = false,
    ): RouteRecord[] {
        const middlewares = [...inheritedMiddlewares, ...this._middlewares]
        const params = new Map([...inheritedParams, ...this._params])
        const isRoot = inheritedRoot || this._isRoot

        const own = this._routes.map((route) => {
            const paramMiddlewares = paramNamesIn(route.path)
                .filter((name) => params.has(name))
                .map((name) => params.get(name)!)
            return {
                ...route,
                // A route is root if it opted in (`.root()`) or any enclosing group did.
                root: route.root || isRoot,
                middlewares: [...middlewares, ...paramMiddlewares, ...route.middlewares],
            }
        })

        const nested = this._children.flatMap((child) => child.finalize(middlewares, params, isRoot))
        const subtree = [...own, ...nested]

        // Fail-fast: a param handler registered on this group that no route in
        // its subtree declares is almost certainly a typo — surface it at startup
        // instead of letting it silently never run.
        for (const name of this._params.keys()) {
            const matchesARoute = subtree.some((route) => paramNamesIn(route.path).includes(name))
            if (!matchesARoute) {
                throw new Error(
                    `param("${name}") on prefix "${this._prefix || "/"}" matches no route — no path under it declares ":${name}"`,
                )
            }
        }

        return subtree
    }
}

/**
 * Collects a module's route definitions. The registry is the root of a small
 * scope tree: `require(...)` binds routes at the root, while `prefix(...)` opens
 * a nested {@link RouteGroupBuilder} whose routes inherit the parent's prefix,
 * `use()` middlewares and `param()` handlers.
 *
 * `require(rai)` is typed with the module's RAIs, so the identifier autocompletes
 * and unknown ones are rejected.
 */
export class RoutesRegistry<Identifier extends string> extends RouteGroupBuilder<Identifier, ""> {
    constructor(grantedRAIs: Set<string>) {
        super("", grantedRAIs)
    }

    /**
     * Module-wide middleware — runs before every route in the module (direct
     * routes and every group). Unlike a group's `use()`, it isn't bound to a
     * prefix, so `req.params` is the generic dictionary.
     */
    public override use(handler: RequestHandler): this {
        this._middlewares.push(handler)
        return this
    }

    /** Every collected route, with its middleware stack fully resolved. */
    get routes(): RouteRecord[] {
        return this.finalize()
    }
}

/** Extracts the `:param` names from a route path, in the order they appear. */
function paramNamesIn(path: string): string[] {
    return [...path.matchAll(/:(\w+)/g)]
        .map((match) => match[1])
        .filter((name): name is string => name !== undefined)
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

    /**
     * Mount this route at its bare path, *outside* the global API prefix — e.g.
     * `/health` instead of `/api/v1/health`. The RAI guard and middlewares still
     * apply; only the mount base changes. Chainable.
     */
    public root(): this {
        this.record.root = true
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
