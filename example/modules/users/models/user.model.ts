import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/core/db";
// Cross-module import by package name, never a relative path out of the
// module — the dependency is declared in package.json, so it is visible.
import { baseSchemaOptions } from "@app/core";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    role: { type: String, required: true, default: "user" },
    // Retained for existing data/custom policies. The starter now authorizes
    // sessions against Credential.version, which changes atomically with its hash.
    tokens_valid_from: { type: Date },
  },
  baseSchemaOptions,
);

export default { name: "User", schema: userSchema } satisfies ModelDef;
