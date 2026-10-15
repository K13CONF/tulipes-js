import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/mongoose";
import { baseSchemaOptions } from "@app/core";

/**
 * One agent run: the goal, who it acts for, and everything the loop needs
 * to resume it in another process — the transcript as the model saw it
 * (append-only), the calls waiting for an answer, the owner's decisions.
 *
 * Never a credential: `token_id` names the API token that started the run,
 * so its revocation can stop it, and nothing more. The transcript holds
 * the API's own message objects, kept as they are (Mixed).
 *
 * Every write goes through `MongoRunStore`, one atomic update each.
 */
const usage = { input: { type: Number, default: 0 }, output: { type: Number, default: 0 }, cache_read: { type: Number, default: 0 }, cache_write: { type: Number, default: 0 } };

const runSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    scopes: { type: [String], default: undefined },
    token_id: { type: String },
    goal: { type: String, required: true },
    status: { type: String, required: true, enum: ["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled", "exhausted"], default: "queued" },
    transcript: { type: [Schema.Types.Mixed], default: [] },
    pending: { type: [Schema.Types.Mixed], default: [] },
    decisions: { type: Schema.Types.Mixed, default: {} },
    executing: { type: Boolean, default: false },
    nudged: { type: Boolean, default: false },
    turns: { type: Number, default: 0 },
    tool_calls: { type: Number, default: 0 },
    usage,
    elapsed_ms: { type: Number, default: 0 },
    notes: { type: [String], default: [] },
    result: {
      type: new Schema({ outcome: String, summary: String, verification: String }, { _id: false }),
      default: undefined,
    },
    reason: { type: String },
    /** The last steps, newest last: the timeline the API returns. */
    steps: { type: [Schema.Types.Mixed], default: [] },
    /** How many jobs this run has been given: the job id's suffix, so one enqueue is one job. */
    segment: { type: Number, default: 0 },
    /** Set when the run ends; the TTL index removes it `retentionDays` later. */
    expires_at: { type: Date, expires: 0 },
  },
  { ...baseSchemaOptions, minimize: false },
);

runSchema.index({ user: 1, created_at: -1 });
runSchema.index({ status: 1 });

export default { name: "AgentRun", schema: runSchema } satisfies ModelDef;
