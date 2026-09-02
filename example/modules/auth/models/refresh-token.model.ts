import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/core/db";

/**
 * One row per issued refresh token, keyed by its jti.
 *
 * Refresh tokens rotate: using one deletes its row and issues a new pair,
 * so a token that is not in this collection is not usable — which is what
 * makes logout and expiry mean something for an otherwise stateless JWT.
 *
 * `expiresAt` carries a TTL index, so mongo removes the rows itself and
 * the collection cannot grow without bound.
 */
const refreshTokenSchema = new Schema({
  jti: { type: String, required: true, unique: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  expiresAt: { type: Date, required: true, expires: 0 },
  createdAt: { type: Date, default: Date.now },
});

export default { name: "RefreshToken", schema: refreshTokenSchema } satisfies ModelDef;
