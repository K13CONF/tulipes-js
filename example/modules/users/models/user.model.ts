import { Schema } from "mongoose";
import type { ModelDef } from "@tulipes/core/db";
// Cross-module import by package name, never a relative path out of the
// module — the dependency is declared in package.json, so it is visible.
import { baseSchemaOptions } from "@app/core";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    role: { type: String, required: true, default: "user" },
    // Every access token issued before this instant is rejected. Auth
    // moves it forward on a password change, which is how one action logs
    // the account out everywhere. Not a secret — the password hash lives
    // in the auth module's Credential model, never here.
    tokens_valid_from: { type: Date },
  },
  baseSchemaOptions,
);

export default { name: "User", schema: userSchema } satisfies ModelDef;
