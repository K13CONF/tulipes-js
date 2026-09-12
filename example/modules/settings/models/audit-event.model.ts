import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/mongoose";

/** Requested actions, acknowledged before their side effect. No values or bodies. */
const auditEventSchema = new Schema({
  action: { type: String, required: true, enum: [
    "variable.reveal_requested", "variable.change_requested", "i18n.change_requested", "reboot.requested",
  ] },
  actor: { type: String, required: true },
  actor_role: { type: String, required: true },
  ip: String,
  app_env: { type: String, required: true },
  mode: { type: String, required: true },
  recorded_at: { type: Date, required: true },
  variable: String,
  module: String,
  locale: String,
  keys: Number,
  target_count: Number,
}, { collection: "settings_audit_events", strict: "throw" });

// No automatic retention: operators own archival/retention for this audit store.
auditEventSchema.index({ actor: 1, recorded_at: -1 });
export default { name: "AuditEvent", schema: auditEventSchema } satisfies ModelDef;
