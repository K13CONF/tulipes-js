import type { Schema } from "mongoose";

import { softDeletePlugin } from "./soft-delete.plugin.ts";
import { timestampsPlugin } from "./timestamps.plugin.ts";

/**
 * The base plugin every model gets. Composes the focused plugins so each
 * stays single-responsibility; new cross-cutting behaviour (audit trail,
 * versioning, …) slots in here without touching call sites.
 */
export function baseModelPlugin(schema: Schema): void {
  schema.plugin(timestampsPlugin);
  schema.plugin(softDeletePlugin);
}
