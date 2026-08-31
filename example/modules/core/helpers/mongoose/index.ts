import type { SchemaOptions } from "mongoose";

export { baseModelPlugin } from "./plugins/base.plugin.js";
export { softDeletePlugin } from "./plugins/soft-delete.plugin.js";
export { timestampsPlugin } from "./plugins/timestamps.plugin.js";
export { registerBasePlugins } from "./register.js";
export type {
  Actor,
  BaseDocument,
  SoftDeleteFields,
  SoftDeleteMethods,
  Timestamps,
} from "./plugins/types.js";

/**
 * Serialization conventions every model spreads into its schema options.
 * Timestamps are NOT set here — the base plugin owns them (snake_case).
 */
export const baseSchemaOptions: SchemaOptions = {
  toJSON: {
    versionKey: false,
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret._id;
      return ret;
    },
  },
};
