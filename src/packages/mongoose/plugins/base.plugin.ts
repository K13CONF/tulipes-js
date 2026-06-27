import type { Schema } from "mongoose"
import { timestampsPlugin } from "./timestamps.plugin.js"
import { softDeletePlugin } from "./soft-delete.plugin.js"

// Re-export the document types so models keep importing them from one place.
export type { BaseDocument, Timestamps, SoftDeleteFields, SoftDeleteMethods, Actor } from "./types.js"

/**
 * The base plugin every model gets. Composes the focused plugins so each stays
 * single-responsibility and new cross-cutting behaviour (audit, versioning, …)
 * can be slotted in here without touching call sites.
 *
 * Applied globally in `src/packages/mongoose/register.ts`; can also be applied
 * per schema with `schema.plugin(baseModelPlugin)`.
 */
export function baseModelPlugin(schema: Schema): void {
    schema.plugin(timestampsPlugin)
    schema.plugin(softDeletePlugin)
}

export default baseModelPlugin
