import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/mongoose";
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

// The auth module's sessions of this account. A virtual, so nothing is
// stored on the user; `?resolve=["sessions"]` on users:bo:list populates it.
userSchema.virtual("sessions", { ref: "Session", localField: "_id", foreignField: "user" });

export default { name: "User", schema: userSchema } satisfies ModelDef;
