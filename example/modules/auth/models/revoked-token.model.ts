import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/core/db";

/**
 * Access tokens are stateless, so logging out cannot un-issue one. This is
 * the blacklist that makes logout immediate: the access token's jti is
 * recorded until its natural expiry, and every authenticated request
 * checks it.
 *
 * Rows carry a TTL index set to the token's own expiry — once the token
 * would have expired anyway, the row deletes itself and the list stays as
 * small as the access-token lifetime allows. That is the argument for
 * keeping JWT_ACCESS_TTL short.
 */
const revokedTokenSchema = new Schema({
  jti: { type: String, required: true, unique: true, index: true },
  expires_at: { type: Date, required: true, expires: 0 },
});

export default { name: "RevokedToken", schema: revokedTokenSchema } satisfies ModelDef;
