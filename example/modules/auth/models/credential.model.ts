import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/core/db";
import { baseSchemaOptions } from "@app/core";

/**
 * Secrets live here, never on the User document.
 *
 * The separation is the point: a route that serialises a user cannot leak
 * a password hash by accident, because the hash is not in that document at
 * all. `select: false` is a second layer — even a query against this
 * collection has to ask for the hash explicitly.
 *
 * One row per user, password only. API keys and OAuth links would be their
 * own models rather than more columns here.
 */
const credentialSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    version: { type: String, required: true },
    password_hash: { type: String, required: true, select: false },
  },
  baseSchemaOptions,
);

export default { name: "Credential", schema: credentialSchema } satisfies ModelDef;
