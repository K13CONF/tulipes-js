import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/mongoose";
import { baseSchemaOptions } from "@app/core";

/**
 * One row per API token: a credential a user issues for an agent or a
 * script, named, optionally expiring, and limited to `scopes` (grant
 * patterns in the ACL's grammar; none means the user's full role).
 *
 * The bearer is `<app>_<token_id>_<secret>`. Only a hash of the secret is
 * stored, and the secret is shown once, when the token is issued.
 * `credential_version` is the password version at issue: a password change
 * retires every token as it retires every session. Revoking deletes the
 * row; `expires_at` carries a TTL index, so an expired token prunes itself.
 */
const apiTokenSchema = new Schema(
  {
    token_id: { type: String, required: true, unique: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    secret_hash: { type: String, required: true, select: false },
    scopes: { type: [String], default: undefined },
    credential_version: { type: String, required: true },
    last_used_at: { type: Date },
    expires_at: { type: Date, expires: 0 },
  },
  baseSchemaOptions,
);

export default { name: "ApiToken", schema: apiTokenSchema } satisfies ModelDef;
