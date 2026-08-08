import passport from "passport"
import { Strategy as LocalStrategy } from "passport-local"
import type { Request, Response } from "express"
import { Authenticable, type Principal } from "./authenticable.js"
import { InvalidCredentialsError } from "./errors.js"

/**
 * Passport wiring — deliberately minimal. Passport's only job here is the
 * credential check at login; it owns no sessions and stores no users. The JWT
 * pair is the sole credential (see `lib/access-control.ts`), sent as a Bearer
 * token — so there is no serialize/deserializeUser.
 */

/**
 * Registers the single local strategy (identifier + password), delegating the
 * actual lookup to the {@link Authenticable} registry. Called once from the
 * auth module's `onInit` — models register themselves during `loadModuleModels`,
 * which the boot sequence guarantees has already run.
 */
export function configurePassport(): void {
    passport.use(
        new LocalStrategy({ usernameField: "identifier", passwordField: "password" }, async (identifier, password, done) => {
            try {
                // done(error, principal | false) — verdicts only, never throws upward.
                done(null, (await Authenticable.authenticate(identifier, password)) ?? false)
            } catch (error) {
                done(error)
            }
        }),
    )
}

/**
 * Runs the local strategy against the current request and resolves the
 * {@link Principal} — or rejects with `InvalidCredentialsError`, which the
 * central error handler renders into the unified envelope. Promisified so the
 * login controller reads as one linear flow instead of a callback pyramid.
 */
export function authenticateLocal(req: Request<any, any, any, any>, res: Response): Promise<Principal> {
    // `any` generics on purpose: this is the boundary where our zod-typed
    // request meets passport's untyped middleware — callers keep their types.
    return new Promise((resolve, reject) => {
        passport.authenticate("local", { session: false }, (error: unknown, principal: Principal | false) => {
            if (error) return reject(error)
            if (!principal) return reject(new InvalidCredentialsError())
            resolve(principal)
        })(req, res, (error?: unknown) => {
            // The strategy never falls through to next() on this path; if it
            // somehow does, surface whatever it carried rather than hanging.
            reject(error ?? new InvalidCredentialsError())
        })
    })
}
