import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/core/db";
// App-owned conventions from lib/ — a relative reach outside the module is
// fine for app-level glue that is deliberately NOT a package.
import { baseSchemaOptions } from "../../../lib/mongoose/index.js";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    role: { type: String, required: true, default: "user" },
  },
  baseSchemaOptions,
);

export default { name: "User", schema: userSchema } satisfies ModelDef;
