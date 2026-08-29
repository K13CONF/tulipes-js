import {
  Schema,
  type Aggregate,
  type HydratedDocument,
  type Model,
  type Query,
} from "mongoose";

import type { Actor, SoftDeleteFields } from "./types.js";

/** Option carried on a query/aggregation to opt out of the soft-delete filter. */
interface SoftDeleteOptions {
  withDeleted?: boolean;
}

const deletedPatch = (by?: Actor) => ({
  is_deleted: true,
  deleted_at: new Date(),
  deleted_by: by ?? null,
});

const restoredPatch = () => ({
  is_deleted: false,
  deleted_at: null,
  deleted_by: null,
});

/**
 * Hides soft-deleted documents from reads and updates. Skipped when the
 * caller opted out via `.withDeleted()` or already targeted `is_deleted`
 * explicitly. Uses `$ne: true` (not `=== false`) so legacy documents
 * missing the field are still treated as live.
 */
function excludeDeleted(this: Query<unknown, unknown>) {
  const { withDeleted } = this.getOptions() as SoftDeleteOptions;
  if (withDeleted) return;
  if (this.getFilter().is_deleted !== undefined) return;
  this.where({ is_deleted: { $ne: true } });
}

/** The aggregation-pipeline equivalent of {@link excludeDeleted}. */
function excludeDeletedFromAggregate(this: Aggregate<unknown[]>) {
  const { withDeleted } = (this.options ?? {}) as SoftDeleteOptions;
  if (withDeleted) return;
  this.pipeline().unshift({ $match: { is_deleted: { $ne: true } } });
}

/**
 * The `deleted_by` actor as a nested sub-schema (no own `_id`) so the whole
 * object can be `null` while the document is live. `refPath` makes `id` a
 * polymorphic reference resolved against the model named in
 * `deleted_by.model`.
 */
const deletedBySchema = new Schema<Actor>(
  {
    model: { type: String, required: true },
    id: { type: Schema.Types.ObjectId, required: true, refPath: "deleted_by.model" },
  },
  { _id: false },
);

/**
 * Soft deletion: an `is_deleted` flag plus `deleted_at` and a polymorphic
 * `deleted_by` actor. Deleted documents are transparently excluded from
 * queries unless explicitly included.
 *
 *   read incl. deleted:   Model.find().withDeleted()   (or setOptions)
 *   read only deleted:    Model.find().onlyDeleted()
 *   delete one:           await doc.softDelete(actor)
 *   delete many:          await Model.softDelete(filter, actor)
 *   restore:              await doc.restore() / await Model.restore(filter)
 */
export function softDeletePlugin(schema: Schema): void {
  schema.add({
    is_deleted: { type: Boolean, default: false, index: true },
    deleted_at: { type: Date, default: null },
    deleted_by: { type: deletedBySchema, default: null },
  });

  // Covers find*, count*, distinct, update*, replace*. Hard deletes
  // (deleteOne/deleteMany) stay literal on purpose — when code says
  // delete, the framework must not silently downgrade it.
  schema.pre(/^(count|find|distinct|update|replace)/, excludeDeleted);
  schema.pre("aggregate", excludeDeletedFromAggregate);

  const query = schema.query as Record<string, (...args: never[]) => unknown>;
  query.withDeleted = function (this: Query<unknown, unknown>) {
    return this.setOptions({ withDeleted: true } as SoftDeleteOptions);
  };
  query.onlyDeleted = function (this: Query<unknown, unknown>) {
    return this.setOptions({ withDeleted: true } as SoftDeleteOptions).where({
      is_deleted: true,
    });
  };

  schema.methods.softDelete = function (
    this: HydratedDocument<SoftDeleteFields>,
    by?: Actor,
  ) {
    this.set(deletedPatch(by));
    return this.save();
  };
  schema.methods.restore = function (this: HydratedDocument<SoftDeleteFields>) {
    this.set(restoredPatch());
    return this.save();
  };

  schema.statics.softDelete = function (
    this: Model<unknown>,
    filter: Record<string, unknown>,
    by?: Actor,
  ) {
    return this.updateMany(filter, { $set: deletedPatch(by) });
  };
  schema.statics.restore = function (
    this: Model<unknown>,
    filter: Record<string, unknown>,
  ) {
    // withDeleted so the guard doesn't filter out the very docs we restore.
    return this.updateMany(filter, { $set: restoredPatch() }).setOptions({
      withDeleted: true,
    } as SoftDeleteOptions);
  };
}
