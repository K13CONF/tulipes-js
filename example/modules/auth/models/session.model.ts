import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/core/db";

/**
 * One row per signed-in device — the server-side half of a stateless JWT.
 *
 * Both tokens of a pair carry this row's `sid`, which is what lets an
 * ACCESS token find its own session: the refresh token's jti changes on
 * every rotation, so it could never serve as the identifier. Keeping the
 * row across rotations is the point — `lastSeenAt`, `ip` and `userAgent`
 * survive, and "sign out this device" is deleting one document.
 *
 * `refreshJti` holds only the CURRENT refresh token. Rotation swaps it in
 * one atomic update, so presenting a superseded refresh token matches
 * nothing and is rejected as a replay.
 *
 * `expiresAt` carries a TTL index, so mongo prunes dead sessions itself.
 */
const sessionSchema = new Schema({
  sid: { type: String, required: true, unique: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  refreshJti: { type: String, required: true, index: true },
  /** Recorded at sign-in; a session that moves address keeps its origin. */
  ip: { type: String },
  userAgent: { type: String },
  lastSeenAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, expires: 0 },
  createdAt: { type: Date, default: Date.now },
});

export default { name: "Session", schema: sessionSchema } satisfies ModelDef;
