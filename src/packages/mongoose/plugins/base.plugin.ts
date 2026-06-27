import type { Schema, Document } from "mongoose";

/**
 * Timestamp fields this plugin manages. Model interfaces extend this (alongside
 * `Document`) to get typed `created_at` / `updated_at`:
 *
 *   export interface IUser extends Document, Timestamps { name: string }
 */
export interface Timestamps {
    created_at: Date;
    updated_at: Date;
}

export type BaseDocument = Timestamps & Document;
/**
 * Mongoose plugin that adds Mongoose-managed `created_at` / `updated_at`
 * timestamps (snake_case) to any schema it's applied to. Mongoose populates the
 * fields automatically on create/update — no manual defaults or hooks needed.
 *
 * Per schema:
 *   const UserSchema = new Schema({ ... });
 *   UserSchema.plugin(baseModelPlugin);
 *
 * Globally (every schema in the app):
 *   mongoose.plugin(baseModelPlugin);
 */
export function baseModelPlugin(schema: Schema): void {
    schema.set("timestamps", {
        createdAt: "created_at",
        updatedAt: "updated_at",
    });
}

export default baseModelPlugin;
