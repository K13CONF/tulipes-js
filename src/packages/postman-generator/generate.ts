import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import config from "@config/app.config.js"
import type { ModuleConfig } from "@/types/module.js"
import type { RouteRecord } from "@packages/acl/define-routes.js"
import { zodSchemaToExample } from "./json-schema-example.js"

/**
 * Builds a Postman Collection v2.1.0 + environment straight from the app's own
 * route tree (`config.app.modules`) — the same config the app boots from, minus
 * any DB/Redis/network side effects. Nothing here executes a request handler or
 * opens a connection; it only reads the in-memory route/ACL metadata.
 */
export class PostmanGenerator {
    constructor(private readonly outDir: string) {}

    /** Writes `<slug>.postman_collection.json` and `<slug>.postman_environment.json` into outDir. */
    public async generate(): Promise<{ collectionPath: string; environmentPath: string }> {
        await mkdir(this.outDir, { recursive: true })

        const slug = slugify(config.app.title)
        const collectionPath = resolve(this.outDir, `${slug}.postman_collection.json`)
        const environmentPath = resolve(this.outDir, `${slug}.postman_environment.json`)

        await writeFile(collectionPath, JSON.stringify(this.buildCollection(), null, 2))
        await writeFile(environmentPath, JSON.stringify(this.buildEnvironment(), null, 2))

        return { collectionPath, environmentPath }
    }

    private buildCollection() {
        return {
            info: {
                name: config.app.title,
                description: config.app.description,
                schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
            },
            auth: { type: "bearer", bearer: [{ key: "token", value: "{{accessToken}}", type: "string" }] },
            item: config.app.modules
                .map((module) => this.buildFolder(module))
                .filter((folder) => folder.item.length > 0),
        }
    }

    private buildEnvironment() {
        return {
            name: config.app.title,
            values: [
                { key: "baseUrl", value: config.app.lib.server.apiPublicAddress, enabled: true },
                { key: "accessToken", value: "", enabled: true },
                { key: "refreshToken", value: "", enabled: true },
            ],
            _postman_variable_scope: "environment",
        }
    }

    private buildFolder(module: ModuleConfig) {
        return { name: module.name, description: module.description, item: module.routes.map((r) => this.buildItem(r)) }
    }

    private buildItem(route: RouteRecord) {
        const body = this.buildBody(route)
        const events = this.buildEvents(route)
        return {
            name: route.documentation?.name ?? `${route.method} ${this.fullPath(route)}`,
            ...(events.length ? { event: events } : {}),
            request: {
                method: route.method,
                description: [route.documentation?.description, `RAI: ${route.rai}`].filter(Boolean).join("\n\n"),
                header: body ? [{ key: "Content-Type", value: "application/json" }] : [],
                url: this.buildUrl(route),
                ...(body ? { body } : {}),
                ...(this.isPublic(route.rai) ? { auth: { type: "noauth" } } : {}),
            },
            response: [],
        }
    }

    private buildEvents(route: RouteRecord) {
        const events: unknown[] = []
        if (route.documentation?.preRequestScript) {
            events.push({ listen: "prerequest", script: { type: "text/javascript", exec: route.documentation.preRequestScript.split("\n") } })
        }
        if (route.documentation?.postResponseScript) {
            events.push({ listen: "test", script: { type: "text/javascript", exec: route.documentation.postResponseScript.split("\n") } })
        }
        return events
    }

    private buildUrl(route: RouteRecord) {
        const full = this.fullPath(route)
        const variables = [...full.matchAll(/:(\w+)/g)].map((m) => ({ key: m[1], value: "" }))
        const query = this.buildQuery(route)
        return {
            raw: `{{baseUrl}}${full}`,
            host: ["{{baseUrl}}"],
            path: full.split("/").filter(Boolean),
            ...(variables.length ? { variable: variables } : {}),
            ...(query.length ? { query } : {}),
        }
    }

    private buildQuery(route: RouteRecord) {
        if (!route.schemas?.query) return []
        const example = zodSchemaToExample(route.schemas.query)
        if (!example || typeof example !== "object") return []
        return Object.entries(example).map(([key, value]) => ({ key, value: String(value), disabled: false }))
    }

    private buildBody(route: RouteRecord) {
        if (!route.schemas?.body) return undefined
        const example = zodSchemaToExample(route.schemas.body)
        if (example === undefined) return undefined
        return { mode: "raw", raw: JSON.stringify(example, null, 2), options: { raw: { language: "json" } } }
    }

    private fullPath(route: RouteRecord): string {
        const base = route.root ? "" : `${config.app.api.prefix}/${config.app.api.version}`
        return `${base}${route.path}`
    }

    private isPublic(rai: string): boolean {
        return config.app.acl.get("public")?.includes(rai) ?? false
    }
}

function slugify(title: string): string {
    return title.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "")
}
