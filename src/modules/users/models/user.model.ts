import mongoose, { Schema } from "mongoose"
import type { BaseDocument } from "@packages/mongoose/plugins/base.plugin.js"
import { ROLE_NAMES, type RoleName } from "@config/roles.definition.js"
import { Authenticable, type AuthenticableMethods } from "@modules/auth/helpers/authenticable.js"

export interface IUser extends BaseDocument, AuthenticableMethods {
    email: string
    username?: string
    /** Argon2 hash — `select: false` (enforced by Authenticable.register). */
    password: string
    roles: RoleName[]
    /** Gate for logging in without deleting the account (bans, offboarding). */
    is_active: boolean
    first_name?: string
    last_name?: string
}

const UserSchema = new Schema<IUser>({
    email: { type: String, required: true, lowercase: true, trim: true },
    username: { type: String, trim: true },
    password: { type: String, required: true },
    roles: { type: [String], enum: ROLE_NAMES, default: ["user"] },
    is_active: { type: Boolean, default: true },
    first_name: { type: String, trim: true },
    last_name: { type: String, trim: true },
})

// Unique among *live* documents only — a soft-deleted account frees its
// identifiers for re-registration (plain unique indexes would block forever).
UserSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { is_deleted: false } })
UserSchema.index(
    { username: 1 },
    { unique: true, partialFilterExpression: { is_deleted: false, username: { $type: "string" } } },
)

// Registering makes this model authenticatable (Django-style): the login
// strategy matches the identifier against these fields, `password` becomes
// select:false, and saves argon2-hash it. Must run before the model compiles.
Authenticable.register(UserSchema, "User", { usernameFields: ["email", "username"] })

// auto-loaded on boot (modelsFolderPath) — no import needed elsewhere
export const UserModel = mongoose.model<IUser>("User", UserSchema)
