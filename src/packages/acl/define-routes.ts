import type { RequestHandler } from "express"
import type { RouteParameters } from "express-serve-static-core"
import type { ACL, RAI } from "./types.js"

/** HTTP methods a route can be bound to. */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH"

/**
 * A fully-described route collected by the registry, ready to be mounted on an
 * Express router by the application.
 */
export interface RouteRecord {
    rai: RAI
    method: HttpMethod
    path: string
    middlewares: RequestHandler[]
}

/**
 * Builds the strongly-typed `defineRoutes` function for a module, bound to that
 * module's RAIs (`Identifier`). The `acl` value is used to validate, at runtime,
 * that every `require(...)` references a granted RAI.
 */
export default function defineRoutesFactory<Identifier extends string>(acl: ACL) {
    // Flatten every granted RAI into a lookup set for runtime validation.
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
    public readonly routes: RouteRecord[] = []

    constructor(private readonly grantedRAIs: Set<string>) {}

    public require(rai: Identifier) {
        // Types already guarantee this; the runtime guard protects against
        // untyped / dynamic callers.
        if (!this.grantedRAIs.has(rai)) {
            throw new Error(`RAI "${rai}" is not granted to any role in this module's ACL`)
        }

        const bind = <Path extends string>(method: HttpMethod, path: Path) => {
            const record: RouteRecord = { rai, method, path, middlewares: [] }
            this.routes.push(record)
            return new RouteBuilder<RouteParameters<Path>>(record)
        }

        return {
            toGET: <Path extends string>(path: Path) => bind("GET", path),
            toPOST: <Path extends string>(path: Path) => bind("POST", path),
            toPUT: <Path extends string>(path: Path) => bind("PUT", path),
            toDELETE: <Path extends string>(path: Path) => bind("DELETE", path),
            toPATCH: <Path extends string>(path: Path) => bind("PATCH", path),
        }
    }
}

/**
 * Chainable middleware builder for a single route. `Params` is the route's path
 * parameters (e.g. `{ userId: string }` for "/users/:userId"), so every handler
 * gets a correctly-typed `req.params`.
 */
export class RouteBuilder<Params> {
    constructor(private readonly record: RouteRecord) {}

    public use(handler: RequestHandler<Params>): this {
        this.record.middlewares.push(handler as RequestHandler)
        return this
    }
}
