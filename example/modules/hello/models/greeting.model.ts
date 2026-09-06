import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/core/db";

// Cross-module import by package name, never a relative path out
// of the module — the dependency is declared in package.json.
import { baseSchemaOptions } from "@app/core";

/**
 * A model file is a DECLARATION, never a registration: the framework
 * compiles the schema on its own connection and puts it in the model
 * store. Never call mongoose.model() yourself.
 *
 * Read it anywhere the context reaches: models!.get("Greeting").
 */
const greetingSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, lowercase: true, trim: true },
    message: { type: String, required: true },
    times_used: { type: Number, default: 0, min: 0 },
  },
  baseSchemaOptions,
);

export default { name: "Greeting", schema: greetingSchema } satisfies ModelDef;
