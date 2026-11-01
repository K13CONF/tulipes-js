import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/mongoose";

/**
 * A requested settings change, acknowledged before it is applied, and then
 * what became of it (`settings.change_completed` with an `outcome`). Only the
 * namespace, the field names and the version travel — never a value, so
 * the record can be read by anyone who may read the audit without seeing
 * what was written.
 */
const configAuditSchema = new Schema({
  action: { type: String, required: true, enum: ["settings.change_requested", "settings.change_completed"] },
  /** On a completion record: what became of the change. */
  outcome: { type: String, enum: ["applied", "applied_on_change_failed", "refused", "conflict", "failed"] },
  module: { type: String, required: true },
  keys: { type: [String], required: true },
  version: { type: Number, required: true },
  actor: { type: String, required: true },
  actor_role: { type: String, required: true },
  ip: String,
  request_id: String,
  app_env: { type: String, required: true },
  mode: { type: String, required: true },
  recorded_at: { type: Date, required: true },
}, { collection: "config_audit_events", strict: "throw" });

// No automatic retention: operators own archival/retention for this audit store.
configAuditSchema.index({ actor: 1, recorded_at: -1 });
configAuditSchema.index({ module: 1, recorded_at: -1 });
export default { name: "ConfigAudit", schema: configAuditSchema } satisfies ModelDef;
