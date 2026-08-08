import crypto from "node:crypto"
import argon2 from "argon2"
import mongoose, { Schema } from "mongoose"

/**
 * Django-style authenticatable-model registry.
 *
 * A model becomes authenticatable by calling `Authenticable.register(schema, …)`
 * before it compiles — the single Passport local strategy then authenticates
 * against every registered model, in registration order. Registering does three
 * things to the schema:
 *
 *   1. forces `select: false` on the password path (never leaves the DB unasked)
 *   2. installs a pre-save hook that argon2id-hashes the password when modified
 *   3. adds a `verifyPassword(plain)` instance method
 *
 * The registry itself (`Authenticable.models`) is what the login strategy walks
 * to resolve an identifier — exactly one place decides "who can log in".
 */

/** What a model must declare to become authenticatable. */
export interface AuthenticableOptions {
    /** Document fields matched against the login identifier (e.g. ["email", "username"]). */
    usernameFields: string[]
    /** Field holding the argon2 hash. Default: "password". */
    passwordField?: string
    /** Field holding the account's role names. Default: "roles". */
    rolesField?: string
    /** Boolean field that must not be `false` for the account to log in. Default: "is_active". */
    activeField?: string
}

/** A registry entry: the model name plus its fully-resolved options. */
export interface RegisteredAuthenticable extends Required<AuthenticableOptions> {
    model: string
}

/**
 * The identity every auth surface speaks in — token payloads, `req.auth`, and
 * responses. `{ model, id }` mirrors the polymorphic `Actor` shape used by the
 * soft-delete plugin, so "who logged in" and "who deleted this" stay symmetric.
 */
export interface Principal {
    model: string
    id: string
    roles: string[]
}

/** Instance surface `register()` adds to authenticatable documents. */
export interface AuthenticableMethods {
    /** Compares a plaintext candidate against the stored argon2 hash. */
    verifyPassword(plain: string): Promise<boolean>
}

/**
 * Hash verified when no account matches the identifier — keeps the response
 * time of "unknown user" indistinguishable from "wrong password", so login
 * timing can't be used to enumerate accounts. Computed once at boot.
 */
const DUMMY_HASH = await argon2.hash(crypto.randomUUID())

export class Authenticable {
    /** Every registered authenticatable model, in registration order. */
    static readonly models: RegisteredAuthenticable[] = []

    /**
     * Makes a model authenticatable. Call on the schema **before**
     * `mongoose.model(...)` compiles it — hooks and paths can't be added after.
     */
    static register(schema: Schema, modelName: string, options: AuthenticableOptions): void {
        if (this.models.some((entry) => entry.model === modelName)) {
            throw new Error(`Model "${modelName}" is already registered as authenticatable`)
        }

        const entry: RegisteredAuthenticable = {
            model: modelName,
            usernameFields: options.usernameFields,
            passwordField: options.passwordField ?? "password",
            rolesField: options.rolesField ?? "roles",
            activeField: options.activeField ?? "is_active",
        }

        // Fail fast at load time — registering against a schema that doesn't
        // declare the password field is a wiring bug, not a runtime condition.
        const passwordPath = schema.path(entry.passwordField)
        if (!passwordPath) {
            throw new Error(
                `Cannot register "${modelName}" as authenticatable: schema has no "${entry.passwordField}" path`,
            )
        }

        // 1. The hash never leaves the DB unless explicitly `.select("+password")`-ed.
        passwordPath.select(false)

        // 2. Hash on the save path whenever the password changed (create, reset, …).
        //    Bulk writes and upserts bypass this hook — account writes must go
        //    through save()/create(), which is the only correct path anyway.
        schema.pre("save", async function () {
            if (!this.isModified(entry.passwordField)) return
            const plain = this.get(entry.passwordField) as string
            this.set(entry.passwordField, await argon2.hash(plain))
        })

        // 3. Constant-shape comparison helper for the login strategy.
        schema.methods["verifyPassword"] = function (plain: string): Promise<boolean> {
            const hash = this.get(entry.passwordField) as string | undefined
            if (!hash) return Promise.resolve(false) // hash not selected or unset
            return argon2.verify(hash, plain)
        }

        this.models.push(entry)
    }

    /**
     * Resolves an identifier + password to a {@link Principal}, walking the
     * registered models in order. The first model whose username fields match
     * the identifier gives the final verdict — a wrong password there does not
     * fall through to later models (identifier precedence stays deterministic).
     */
    static async authenticate(identifier: string, password: string): Promise<Principal | null> {
        for (const entry of this.models) {
            const Model = mongoose.model(entry.model)

            // Soft-deleted accounts are auto-excluded by the global base plugin.
            const doc = await Model.findOne({
                $or: entry.usernameFields.map((field) => ({ [field]: identifier })),
            }).select(`+${entry.passwordField}`)
            if (!doc) continue

            if (doc.get(entry.activeField) === false) return null
            const valid = await (doc as unknown as AuthenticableMethods).verifyPassword(password)
            return valid ? toPrincipal(entry, doc) : null
        }

        // No account matched: burn the same argon2 work a real check would.
        await argon2.verify(DUMMY_HASH, password).catch(() => false)
        return null
    }

    /**
     * Re-resolves a Principal from the database — used where fresh state matters
     * (token refresh, `/auth/me`): picks up role changes, deactivation, and
     * soft deletion that happened after the token was minted.
     */
    static async resolvePrincipal(modelName: string, id: string): Promise<Principal | null> {
        const entry = this.models.find((candidate) => candidate.model === modelName)
        if (!entry) return null

        const doc = await mongoose.model(entry.model).findById(id)
        if (!doc || doc.get(entry.activeField) === false) return null
        return toPrincipal(entry, doc)
    }
}

/** Projects a hydrated document down to the Principal the auth layer carries. */
function toPrincipal(entry: RegisteredAuthenticable, doc: mongoose.Document): Principal {
    const roles = doc.get(entry.rolesField) as string[] | undefined
    return {
        model: entry.model,
        id: String(doc._id),
        roles: Array.isArray(roles) ? roles : [],
    }
}
