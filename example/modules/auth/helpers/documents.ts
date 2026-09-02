import type { Types } from "mongoose";

/**
 * The shapes auth reads through the model store.
 *
 * `models.get()` is generic precisely so a consumer can say what it
 * expects — the store cannot know, since models are registered by name
 * from other modules. Declaring them here keeps the casts in one file
 * instead of scattered through the handlers.
 */
export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  role: string;
  tokensValidFrom?: Date;
}

export interface CredentialDoc {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  passwordHash: string;
}
