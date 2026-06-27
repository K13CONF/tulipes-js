import type { Schema } from "mongoose"

/**
 * Adds Mongoose-managed `created_at` / `updated_at` (snake_case) to a schema.
 * Mongoose populates them on create/update — no manual defaults or hooks needed.
 *
 *   const UserSchema = new Schema({ ... })
 *   UserSchema.plugin(timestampsPlugin)
 */
export function timestampsPlugin(schema: Schema): void {
    schema.set("timestamps", {
        createdAt: "created_at",
        updatedAt: "updated_at",
    })
}

export default timestampsPlugin
