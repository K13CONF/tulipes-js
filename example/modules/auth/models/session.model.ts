import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/core/db";
import { baseSchemaOptions } from "@app/core";

/**
 * One row per signed-in device — the server-side half of a stateless JWT.
 *
 * Both tokens of a pair carry this row's `sid`, which is what lets an
 * ACCESS token find its own session: the refresh token's jti changes on
 * every rotation, so it could never serve as the identifier. Keeping the
 * row across rotations is the point — `last_seen_at`, `ip` and `user_agent`
 * survive, and "sign out this device" is deleting one document.
 *
 * `refresh_jti` holds only the CURRENT refresh token. Rotation swaps it in
 * one atomic update, so presenting a superseded refresh token matches
 * nothing and is rejected as a replay.
 *
 * `expires_at` carries a TTL index, so mongo prunes dead sessions itself.
 * `created_at` is not declared here — baseSchemaOptions provides it.
 */
const sessionSchema = new Schema(
  {
    sid: { type: String, required: true, unique: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    refresh_jti: { type: String, required: true, index: true },
    /** Recorded at sign-in; a session that moves address keeps its origin. */
    ip: { type: String },
    user_agent: { type: String },
    last_seen_at: { type: Date, default: Date.now },
    expires_at: { type: Date, required: true, expires: 0 },
  },
  baseSchemaOptions,
);

export default { name: "Session", schema: sessionSchema } satisfies ModelDef;
