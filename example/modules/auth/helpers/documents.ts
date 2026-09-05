import type { HydratedDocument, Types } from "mongoose";

/**
 * The shapes auth reads through the model store.
 *
 * `models.get()` is generic precisely so a consumer can say what it
 * expects — the store cannot know, since models are registered by name
 * from other modules. Declaring them here keeps the casts in one file
 * instead of scattered through the handlers.
 */
export interface UserAttrs {
  _id: Types.ObjectId;
  email: string;
  role: string;
  tokensValidFrom?: Date;
}

export interface SessionAttrs {
  _id: Types.ObjectId;
  sid: string;
  user: Types.ObjectId;
  refreshJti: string;
  ip?: string;
  userAgent?: string;
  lastSeenAt?: Date;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * `req.auth.user` and `req.auth.session` are hydrated documents, not lean
 * objects: the plugins and instance methods are available on them, and a
 * handler holding one can save it.
 *
 * The cost of that convenience is that the request object is now a write
 * handle — mutating `req.auth.user` and saving it persists, wherever in a
 * handler that happens.
 */
export type UserDoc = HydratedDocument<UserAttrs>;
export type SessionDoc = HydratedDocument<SessionAttrs>;

export interface CredentialDoc {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  passwordHash: string;
}
