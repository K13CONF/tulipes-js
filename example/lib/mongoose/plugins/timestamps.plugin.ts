import type { Schema } from "mongoose";

/**
 * Mongoose-managed `created_at` / `updated_at` (snake_case, matching the
 * API's wire format). Mongoose populates them on create/update — no manual
 * defaults or hooks needed.
 */
export function timestampsPlugin(schema: Schema): void {
  schema.set("timestamps", {
    createdAt: "created_at",
    updatedAt: "updated_at",
  });
}
