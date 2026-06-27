import { Schema, type Query, type Aggregate, type HydratedDocument } from "mongoose"
import type { Actor, SoftDeleteFields } from "./types.js"

/** Option carried on a query/aggregation to opt out of the soft-delete filter. */
interface SoftDeleteOptions {
    withDeleted?: boolean
}

/** `$set` payload that marks a document deleted. */
const deletedPatch = (by?: Actor) => ({
    is_deleted: true,
    deleted_at: new Date(),
    deleted_by: by ?? null,
})

/** `$set` payload that clears the soft-delete flags. */
const restoredPatch = () => ({
    is_deleted: false,
    deleted_at: null,
    deleted_by: null,
})

/**
 * Hides soft-deleted documents from reads and updates. Skipped when the caller
 * opted out via `.withDeleted()` or already targeted `is_deleted` explicitly.
 * Uses `$ne: true` (not `=== false`) so legacy documents missing the field are
 * still treated as live.
 */
function excludeDeleted(this: Query<unknown, unknown>) {
    const { withDeleted } = this.getOptions() as SoftDeleteOptions
    if (withDeleted) return
    if (this.getFilter().is_deleted !== undefined) return
    this.where({ is_deleted: { $ne: true } })
}

/** The aggregation-pipeline equivalent of {@link excludeDeleted}. */
function excludeDeletedFromAggregate(this: Aggregate<unknown[]>) {
    const { withDeleted } = (this.options ?? {}) as SoftDeleteOptions
    if (withDeleted) return
    this.pipeline().unshift({ $match: { is_deleted: { $ne: true } } })
}

/**
 * Mongoose plugin adding soft deletion: an `is_deleted` flag plus `deleted_at`
 * and a polymorphic `deleted_by` actor. Deleted documents are transparently
 * excluded from queries unless explicitly included.
 *
 * Read with deleted docs:   `Model.find().withDeleted()`
 * Read only deleted docs:   `Model.find().onlyDeleted()`
 * Delete one:               `await doc.softDelete(actor)`
 * Delete many:              `await Model.softDelete(filter, actor)`
 * Restore:                  `await doc.restore()` / `await Model.restore(filter)`
 */
export function softDeletePlugin(schema: Schema): void {
    // ── Fields ───────────────────────────────────────────────────────────────
    schema.add({
        is_deleted: { type: Boolean, default: false, index: true },
        deleted_at: { type: Date, default: null },
        deleted_by: {
            model: { type: String, default: null },
            id: { type: Schema.Types.ObjectId, refPath: "deleted_by.model", default: null },
        },
    })

    // ── Auto-exclude deleted docs from reads/updates ──────────────────────────
    // Covers find*, count*, distinct, update*, replace*. Hard deletes
    // (deleteOne/deleteMany) are intentionally left literal.
    schema.pre(/^(count|find|distinct|update|replace)/, excludeDeleted)
    schema.pre("aggregate", excludeDeletedFromAggregate)

    // ── Query helpers: explicit opt-out ───────────────────────────────────────
    const query = schema.query as Record<string, (...args: unknown[]) => unknown>
    query.withDeleted = function (this: Query<unknown, unknown>) {
        return this.setOptions({ withDeleted: true } as SoftDeleteOptions)
    }
    query.onlyDeleted = function (this: Query<unknown, unknown>) {
        return this.setOptions({ withDeleted: true } as SoftDeleteOptions).where({ is_deleted: true })
    }

    // ── Instance methods ──────────────────────────────────────────────────────
    schema.methods.softDelete = function (this: HydratedDocument<SoftDeleteFields>, by?: Actor) {
        this.set(deletedPatch(by))
        return this.save()
    }
    schema.methods.restore = function (this: HydratedDocument<SoftDeleteFields>) {
        this.set(restoredPatch())
        return this.save()
    }

    // ── Statics (bulk) ────────────────────────────────────────────────────────
    schema.statics.softDelete = function (filter: Record<string, unknown>, by?: Actor) {
        return this.updateMany(filter, { $set: deletedPatch(by) })
    }
    schema.statics.restore = function (filter: Record<string, unknown>) {
        // withDeleted so the guard doesn't filter out the very docs we restore.
        return this.updateMany(filter, { $set: restoredPatch() }).setOptions({
            withDeleted: true,
        } as SoftDeleteOptions)
    }
}

export default softDeletePlugin
