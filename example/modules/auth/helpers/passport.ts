import passport from "passport";
import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";
import { Strategy as LocalStrategy } from "passport-local";
import type { Ctx } from "@tulipes/core/boot";

import { verifyPassword } from "./passwords.js";
import { isRevoked, type TokenClaims } from "./tokens.js";
import { GUEST, type Principal } from "./principal.js";
import type { CredentialDoc, UserDoc } from "./documents.js";

/**
 * Two strategies, both stateless (`session: false`):
 *
 *   local  runs once, at login, to check an email and password
 *   jwt    runs on every request, to turn a Bearer token into a principal
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
            .findOne({ email: String(email).toLowerCase() })
            .lean();
          if (!user) return done(null, false);

          // The hash is select:false, so it has to be asked for by name.
          const credential = await ctx.models!
            .get<CredentialDoc>("Credential")
            .findOne({ user: user._id })
            .select("+passwordHash")
            .lean();
          if (!credential) return done(null, false);

          const ok = await verifyPassword(password, credential.passwordHash);
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

          const record = await ctx.models!.get<UserDoc>("User").findById(claims.sub).lean();
          if (!record) return done(null, false);

          // A password change moves this epoch forward, which invalidates
          // every token issued before it — on every device at once.
          //
          // Compared at second precision, because `iat` only has seconds:
          // a token minted milliseconds *after* the epoch would otherwise
          // look older than it and reject itself the moment it was issued.
          if (record.tokensValidFrom) {
            const epochSeconds = Math.floor(record.tokensValidFrom.getTime() / 1000);
            if (claims.iat < epochSeconds) return done(null, false);
          }

          const resolved: Principal = {
            id: String(record._id),
            email: record.email,
            role: record.role,
            jti: claims.jti,
            authenticated: true,
          };
          return done(null, resolved as Express.User);
        } catch (error) {
          return done(error as Error);
        }
      },
    ),
  );
}

/**
 * Runs on every request. Populates `req.principal`, and never rejects:
 * an unauthenticated caller becomes GUEST, and the ACL decides from there.
 */
export function authenticate(): import("express").RequestHandler {
  return (req, res, next) => {
    passport.authenticate("jwt", { session: false }, (_err: unknown, user: Principal | false) => {
      req.principal = user || GUEST;
      next();
    })(req, res, next);
  };
}
