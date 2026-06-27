import type { Document, ObjectId, Types } from "mongoose"

/**
 * Who performed a soft delete — a polymorphic reference. `model` is the actor's
 * Mongoose model name (e.g. "User") and `id` its `_id`; together they let
 * `.populate("deleted_by.id")` resolve the actor via `refPath`.
 */
export interface Actor {
    model: string
    id: Types.ObjectId
}

/** Timestamp fields added by `timestampsPlugin`. */
export interface Timestamps {
    created_at: Date
    updated_at: Date
}

/** Fields added by `softDeletePlugin`. */
export interface SoftDeleteFields {
    is_deleted: boolean
    deleted_at: Date | null
    deleted_by: Actor | null
}

/** Instance methods added by `softDeletePlugin`. */
export interface SoftDeleteMethods {
    /** Flag this document as deleted (optionally recording the actor) and save. */
    softDelete(by?: Actor): Promise<this>
    /** Clear the soft-delete flags and save. */
    restore(): Promise<this>
}

/**
 * Everything the global base plugin contributes to a document. Model interfaces
 * extend this to inherit the fields and methods, typed. The `_id` type defaults
 * to `ObjectId` but can be overridden (e.g. a string id):
 *
 *   export interface IUser extends BaseDocument { name: string }
 *   export interface IPermission extends BaseDocument<string> { name: string }
 */
export type BaseDocument<
    T = ObjectId,
    TQueryHelpers = any,
    DocType = any,
    TVirtuals = Record<string, any>,
    TSchemaOptions = {},
> = Document<T, TQueryHelpers, DocType, TVirtuals, TSchemaOptions>
    & Timestamps
    & SoftDeleteFields
    & SoftDeleteMethods
