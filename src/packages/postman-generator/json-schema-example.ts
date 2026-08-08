import { z, type ZodType } from "zod"

/** Best-effort example value for a zod schema, via its JSON Schema projection. Returns `undefined` if the schema can't be converted (e.g. `z.custom()`). */
export function zodSchemaToExample(schema: ZodType): unknown {
    try {
        return fromJsonSchema(z.toJSONSchema(schema))
    } catch {
        return undefined
    }
}

function fromJsonSchema(node: any): unknown {
    if (node.enum) return node.enum[0]

    switch (node.type) {
        case "object": {
            const out: Record<string, unknown> = {}
            for (const [key, prop] of Object.entries(node.properties ?? {})) out[key] = fromJsonSchema(prop)
            return out
        }
        case "array":
            return [fromJsonSchema(node.items ?? {})]
        case "string":
            return node.default ?? (node.format === "email" ? "user@example.com" : "string")
        case "number":
        case "integer":
            return node.default ?? node.minimum ?? 1
        case "boolean":
            return node.default ?? true
        default:
            return null
    }
}
