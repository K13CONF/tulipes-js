import passport from "passport";
import { randomUUID } from "node:crypto";
import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";
import { Strategy as LocalStrategy } from "passport-local";
import type { Ctx } from "@tulipes/core/boot";
import type { Auth } from "@tulipes/core/http";

import { verifyPassword } from "./passwords.ts";
import {
  isRevoked,
  loadSession,
  touchSession,
  type TokenClaims,
} from "./tokens.ts";
import { GUEST } from "./auth.ts";
import { readIdentity, writeIdentity } from "./session-cache.ts";
import type {
  CredentialDoc,
  PasswordIdentity,
  SessionAttrs,
  SessionDoc,
  UserAttrs,
  UserDoc,
} from "./documents.ts";

/**
 * Two strategies, both stateless as far as passport is concerned
 * (`session: false` — this module keeps its own session rows):
 *
 *   local  runs once, at login, to check an email and password
 *   jwt    runs on every request, to turn a Bearer token into a req.auth
 *
 * The jwt strategy never trusts the token's claims for authority: it
 * resolves the session and the user, from the app cache when a request
 * resolved them recently and nothing revoked them since (one Redis read),
 * from the database otherwise (three reads). Every revocation deletes the
 * cached entry, which is what makes a demotion, a ban or a logout take
 * effect on the next request instead of whenever the token expires.
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
          const Credential = ctx.models!.get<CredentialDoc>("Credential");
          const credential = await Credential
            .findOne({ user: user._id })
            .select("+password_hash")
            .lean();
          if (!credential) return done(null, false);

          const ok = await verifyPassword(password, credential.password_hash);
          if (!ok) return done(null, false);

          if (!credential.version) {
            // Upgrade a legacy credential only if the verified hash is unchanged.
            // A racing password change or another upgrade makes this login retry.
            const version = randomUUID();
            const upgraded = await Credential.updateOne(
              {
                user: user._id,
                password_hash: credential.password_hash,
                version: { $exists: false },
              },
              { $set: { version } },
            );
            if (!upgraded.matchedCount) return done(null, false);
            credential.version = version;
          }

          return done(null, {
            user,
            credentialVersion: credential.version,
          } satisfies PasswordIdentity);
        } catch (error) {
          return done(error as Error);
        }
      },
    ),
  );

  passport.use(
    new JwtStrategy(
      {
        // Cookies and URL parameters never authenticate this starter. A cookie
        // extractor would also need the policy described in docs/browser-auth.md.
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKey: ctx.config.auth!.jwtAccessSecret,
        passReqToCallback: false,
      },
      async (claims: TokenClaims, done) => {
        try {
          if (claims.typ !== "access") return done(null, false);

          // A hit is the identity a cold path resolved moments ago, for
          // this sid and subject, and no revocation has run since — every
          // revocation path deletes the entry before it answers. Documents
          // are hydrated from the cached attributes, so handlers hold the
          // same kind of value either way.
          const cached = await readIdentity(ctx, claims.sid);
          if (cached && String(cached.user._id) === claims.sub && cached.session.sid === claims.sid
            && new Date(cached.session.expires_at).getTime() > Date.now()) {
            const user = ctx.models!.get<UserDoc>("User").hydrate(cached.user) as UserDoc;
            const session = ctx.models!.get<SessionDoc>("Session").hydrate(cached.session) as SessionDoc;
            if (await touchSession(ctx, session, touchInterval(ctx))) {
              await writeIdentity(ctx, claims.sid, { user: cached.user, session: session.toObject() as SessionAttrs });
            }
            return done(null, resolve(user, session, claims) as unknown as Express.User);
          }

          // Logout blacklists the jti; without this check a "logged out"
          // token keeps working until it expires.
          if (await isRevoked(ctx, claims.jti)) return done(null, false);

          // The session row is the server-side half: deleting it signs the
          // device out even though the access token is still signed and
          // unexpired. A token whose session is gone is not a caller.
          const session = await loadSession(ctx, claims.sid, claims.sub);
          if (!session) return done(null, false);

          const user = await ctx.models!.get<UserDoc>("User").findById(claims.sub);
          if (!user) return done(null, false);

          await touchSession(ctx, session, touchInterval(ctx));
          await writeIdentity(ctx, claims.sid, { user: user.toObject() as UserAttrs, session: session.toObject() as SessionAttrs });

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
    passport.authenticate(
      "jwt",
      { session: false },
      (_err: unknown, resolved: Auth | false) => {
        req.auth = resolved || { ...GUEST };
        next();
      },
    )(req, res, next);
  };
}
