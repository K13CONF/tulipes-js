import type { Role } from "@/config/roles.definition.js";
import type { ACL, RAI } from "./types.js";
import { type RequestHandler } from "express"

/**
 * This will return the define routes function fully typed
 * ready to be used with the module's acl 
 */
export default function defineRoutesFactory<T extends Role['name'], k>(acl: ACL<T, k>) {

    return defineRoutes;
}

function defineRoutes(callback: (registry: RoutesRegistry<string>) => void) {
    const registry = new RoutesRegistry()
    return callback(registry)
}

class RoutesRegistry<T extends string> {
    private routesMap: Map<T, Array<Route<T>>>;
    constructor() {
        this.routesMap = new Map()
    }

    private routeFactory(route: Route<T>, method: "GET" | "PUT" | "POST" | "DELETE" | "PATCH", path: string) {
        return { use: route.use };
    }

    public require(rai: RAI<T>) {
        this.routesMap.set(rai, [])
        const route = new Route(rai)

        return {
            toGET: (path: string) => this.routeFactory(route, "GET", path),
            toPOST: (path: string) => this.routeFactory(route, "POST", path),
            toPUT: (path: string) => this.routeFactory(route, "PUT", path),
            toDELETE: (path: string) => this.routeFactory(route, "DELETE", path),
            toPATCH: (path: string) => this.routeFactory(route, "PATCH", path),
        };
    }
}

class Route<T extends string> {
    private middlewaresMap: Map<T, Array<RequestHandler>>;
    private rai: RAI<T>;
    constructor(rai: RAI<T>) {
        this.rai = rai
        this.middlewaresMap = new Map()
        this.middlewaresMap.set(rai, [])
    }

    public use(handler: RequestHandler) {
        if (!this.rai) throw new Error('You should init the rai');
        if (!this.middlewaresMap.get(this.rai) || Array.isArray(this.middlewaresMap.get(this.rai))) throw new Error("INVALID ARRAY MIDDLEWARES")
        this.middlewaresMap?.get(this.rai)?.push(handler)
        return { use: this.use }
    }
}