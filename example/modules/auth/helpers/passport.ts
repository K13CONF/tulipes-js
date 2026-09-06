import passport from "passport";
import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";
import { Strategy as LocalStrategy } from "passport-local";
import type { Ctx } from "@tulipes/core/boot";
import type { Auth } from "@tulipes/core/http";

import { verifyPassword } from "./passwords.js";
import { isRevoked, loadSession, touchSession, type TokenClaims } from "./tokens.js";
import { GUEST } from "./auth.js";
import type { CredentialDoc, SessionDoc, UserDoc } from "./documents.js";

/**
 * Two strategies, both stateless as far as passport is concerned
 * (`session: false` — this module keeps its own session rows):
 *
 *   local  runs once, at login, to check an email and password
 *   jwt    runs on every request, to turn a Bearer token into a req.auth
 *
 * The jwt strategy reloads the user on each request rather than trusting
 * the token's claims. It costs a query, and it is what makes a demotion or
 * a ban take effect immediately instead of whenever the token expires.
 */
export function configurePassport(ctx: Ctx): void {
  passport.use(
    new LocalStrategy(
      { usernameField: "email", passwordField: "password", session: false },
      async (email, password, done) => {
        try {
          const user = await ctx.models!
            .get<UserDoc>("User")
            .findOne({ email: String(email).toLowerCase() });
          if (!user) return done(null, false);

          // The hash is select:false, so it has to be asked for by name.
          const credential = await ctx.models!
            .get<CredentialDoc>("Credential")
            .findOne({ user: user._id })
            .select("+password_hash")
            .lean();
          if (!credential) return done(null, false);

          const ok = await verifyPassword(password, credential.password_hash);
          return done(null, ok ? (user as Express.User) : false);
        } catch (error) {
          return done(error as Error);
        }
      },
    ),
  );

  passport.use(
    new JwtStrategy(
      {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKey: String(ctx.Environment.get("JWT_ACCESS_SECRET")),
        passReqToCallback: false,
      },
      async (claims: TokenClaims, done) => {
        try {
          if (claims.typ !== "access") return done(null, false);

          // Logout blacklists the jti; without this check a "logged out"
          // token keeps working until it expires.
          if (await isRevoked(ctx, claims.jti)) return done(null, false);

          // The session row is the server-side half: deleting it signs the
          // device out even though the access token is still signed and
          // unexpired. A token whose session is gone is not a caller.
          const session = await loadSession(ctx, claims.sid);
          if (!session) return done(null, false);

          const user = await ctx.models!.get<UserDoc>("User").findById(claims.sub);
          if (!user) return done(null, false);

          // A password change moves this epoch forward, which invalidates
          // every token issued before it — on every device at once.
          //
          // Compared at second precision, because `iat` only has seconds:
          // a token minted milliseconds *after* the epoch would otherwise
          // look older than it and reject itself the moment it was issued.
          if (user.tokens_valid_from) {
            const epochSeconds = Math.floor(user.tokens_valid_from.getTime() / 1000);
            if (claims.iat < epochSeconds) return done(null, false);
          }

          await touchSession(ctx, session, touchInterval(ctx));

          return done(null, resolve(user, session, claims) as unknown as Express.User);
        } catch (error) {
          return done(error as Error);
        }
      },
    ),
  );
}

/**
 * The session row plus the token in hand. The three access-token fields
 * are attached to the document rather than stored on it — they belong to
 * one request, while the row outlives every token it ever issued.
 */
function resolve(user: UserDoc, session: SessionDoc, claims: TokenClaims): Auth {
  return {
    isAuthenticated: true,
    user,
    session: Object.assign(session, {
      access_jti: claims.jti,
      access_issued_at: new Date(claims.iat * 1000),
      access_expires_at: new Date(claims.exp * 1000),
    }),
  };
}

/** How stale `last_seen_at` may get before a request pays for a write. */
function touchInterval(ctx: Ctx): number {
  return Number(ctx.config.auth?.sessionTouchSeconds ?? 60);
}

/**
 * Runs on every request. Populates `req.auth`, and never rejects: an
 * unauthenticated caller becomes the guest, and the ACL decides from there.
 */
export function authenticate(): import("express").RequestHandler {
  return (req, res, next) => {
    passport.authenticate("jwt", { session: false }, (_err: unknown, resolved: Auth | false) => {
      req.auth = resolved || GUEST;
      next();
    })(req, res, next);
  };
}
