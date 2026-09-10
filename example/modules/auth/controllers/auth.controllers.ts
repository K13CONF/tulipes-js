import passport from "passport";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError, ValidationError, type FieldIssue } from "@tulipes/core/http";

import { auth } from "../helpers/auth.js";
import type { PasswordIdentity, UserDoc } from "../helpers/documents.js";
import { setPassword } from "../helpers/passwords.js";
import {
  endSession,
  listSessions,
  originOf,
  rotateSession,
  startSession,
  revokeAccess,
  verify,
  type TokenClaims,
} from "../helpers/tokens.js";

interface Credentials {
  email?: string;
  password?: string;
}

/**
 * One class per controller, holding the context.
 *
 * Each method *returns* a handler rather than being one, so the routes
 * file reads as a table of contents — `auth.login()` — and the class can
 * keep private helpers beside the handlers that use them without
 * threading ctx through every signature.
 *
 * Every response goes through `res.respond`; failures are thrown and the
 * framework's terminal handler builds the same envelope from them.
 *
 * Thrown messages are i18n KEYS — the handler translates them in this
 * module's namespace and derives the code from the key, so
 * "invalidCredentials" becomes INVALID_CREDENTIALS with a translated
 * message and there is no second string to keep in step.
 */
export class AuthController {
  constructor(private readonly ctx: Ctx) {}

  /** Creates the account and its credential. */
  register(): RequestHandler {
    return async (req: Request, res: Response) => {
      const { email, password } = (req.body ?? {}) as Credentials;

      // Both fields are checked before answering: a form wrong in two
      // places should say so once, not across two round trips.
      const issues: FieldIssue[] = [];
      if (!email) issues.push({ field: "email", message: "emailRequired" });
      if (!password || password.length < 8) {
        issues.push({ field: "password", message: "passwordTooShort" });
      }
      if (issues.length > 0) throw new ValidationError(issues);
      // The guards above threw unless both are present — a narrowing
      // TypeScript cannot make through the issues array.

      if (this.ctx.config.users?.signupMode !== "open") {
        const mode = this.ctx.config.users?.signupMode ?? "closed";
        throw new HttpError(403, req.t("registrationClosed", { mode }), {
          code: "REGISTRATION_CLOSED",
        });
      }

      const User = this.ctx.models!.get<UserDoc>("User");
      const normalised = email!.toLowerCase();
      if (await User.countDocuments({ email: normalised }).limit(1)) {
        // Deliberately the same shape as any other validation failure: a
        // distinct message would turn registration into an oracle for
        // which addresses already have accounts.
        throw new HttpError(422, "emailUnavailable", { field: "email" });
      }

      const user = await User.create({ email: normalised, role: "user" });
      const credentialVersion = await setPassword(this.ctx, String(user._id), password!);

      const tokens = await startSession(this.ctx, String(user._id), credentialVersion, originOf(req));
      res.respond({
        status: 201,
        data: {
          user: { id: String(user._id), email: normalised, role: "user" },
          ...tokens,
        },
      });
    };
  }

  /** passport-local checks the password; this mints the pair. */
  login(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      passport.authenticate(
        "local",
        { session: false },
        async (error: unknown, identity: PasswordIdentity | false) => {
          if (error) return next(error);
          // One message for "no such user" and "wrong password" alike.
          if (!identity) return next(new HttpError(401, "invalidCredentials"));
          const { user, credentialVersion } = identity;

          try {
            const tokens = await startSession(this.ctx, String(user._id), credentialVersion, originOf(req));
            res.respond({
              data: {
                user: { id: String(user._id), email: user.email, role: user.role },
                ...tokens,
              },
            });
          } catch (issueError) {
            next(issueError);
          }
        },
      )(req, res, next);
    };
  }

  /** Rotates the pair, consuming the refresh token presented. */
  refresh(): RequestHandler {
    return async (req: Request, res: Response) => {
      const { refresh_token } = (req.body ?? {}) as { refresh_token?: string };
      if (!refresh_token) {
        throw new HttpError(422, "refreshRequired", { field: "refresh_token" });
      }

      const claims = verify(this.ctx, refresh_token, "refresh");
      if (!claims) throw new HttpError(401, "refreshInvalid", { field: "refresh_token" });

      const user = await this.ctx.models!.get<UserDoc>("User").findById(claims.sub).lean();
      if (!user) throw new HttpError(401, "accountGone");

      // Rotating in place is what stops the same refresh token being
      // exchanged twice: the update matches only the jti still current on
      // the session row, so a replay — or the loser of a race — finds
      // nothing. The session itself survives, keeping its device and its
      // history.
      const tokens = await rotateSession(this.ctx, claims);
      if (!tokens) throw new HttpError(401, "refreshUsed", { field: "refresh_token" });

      res.respond({ data: tokens });
    };
  }

  /** Ends this session immediately — both halves of it. */
  logout(): RequestHandler {
    return async (req: Request, res: Response) => {
      const { user, session } = auth(req);

      // Deleting the row kills the refresh half: no session, no rotation,
      // and the next request carrying this access token resolves to guest.
      if (session) await endSession(this.ctx, session.sid);

      // Blacklisting the access token is what makes logout take effect
      // now, rather than whenever the token would have expired.
      const access = this.#accessClaims(req);
      if (access) await revokeAccess(this.ctx, access);

      res.respond({
        data: {
          message: req.t("loggedOut"),
          logged_out: true,
          user: user ? String(user._id) : null,
        },
      });
    };
  }

  /** Whoever the request pipeline resolved, and the session behind it. */
  me(): RequestHandler {
    return (req: Request, res: Response) => {
      const { isAuthenticated, user, session } = req.auth;

      res.respond({
        data: {
          is_authenticated: isAuthenticated,
          locale: req.locale,
          user: user && { id: String(user._id), email: user.email, role: user.role },
          session: session && {
            sid: session.sid,
            ip: session.ip,
            user_agent: session.user_agent,
            started_at: session.created_at,
            last_seen_at: session.last_seen_at,
            expires_at: session.expires_at,
            access_expires_at: session.access_expires_at,
          },
        },
      });
    };
  }

  /** Every device this account is signed in on. */
  sessions(): RequestHandler {
    return async (req: Request, res: Response) => {
      const { user, session } = req.auth;
      const rows = await listSessions(this.ctx, String(user!._id));

      res.respond({
        data: rows.map((row) => ({
          sid: row.sid,
          current: row.sid === session?.sid,
          ip: row.ip,
          user_agent: row.user_agent,
          started_at: row.created_at,
          last_seen_at: row.last_seen_at,
        })),
        meta: { total_items: rows.length },
      });
    };
  }

  /** Sign one other device out, by the sid from `sessions()`. */
  revokeSession(): RequestHandler {
    return async (req: Request, res: Response) => {
      const { user } = req.auth;
      const { sid } = req.params;

      // Scoped to the caller's own sessions: a sid is guessable enough
      // that ending anyone else's must not be one request away.
      const owned = await listSessions(this.ctx, String(user!._id));
      if (!owned.some((row) => row.sid === sid)) {
        throw new HttpError(404, "noSuchSession", { field: "sid" });
      }

      await endSession(this.ctx, String(sid));
      res.respond({ data: { message: req.t("sessionEnded"), sid } });
    };
  }

  /** Changes own password, ending every other session. */
  changePassword(): RequestHandler {
    return async (req: Request, res: Response) => {
      const userId = String(req.auth.user!._id);
      const { password } = (req.body ?? {}) as { password?: string };
      this.#assertPassword(password);

      // Capture the version written by this change, even if another change races.
      const expectedVersion = req.auth.session?.credential_version;
      if (!expectedVersion) throw new HttpError(401, "invalidCredentials");
      const credentialVersion = await setPassword(this.ctx, userId, password!, expectedVersion);

      // Every earlier token is dead now, including the one that made this
      // request — a fresh session keeps this client signed in while the
      // other devices are signed out.
      const tokens = await startSession(this.ctx, userId, credentialVersion, originOf(req));
      res.respond({
        data: {
          message: req.t("passwordChanged"),
          changed: true,
          sessions_revoked: true,
          ...tokens,
        },
      });
    };
  }

  // Takes the request only to reach `req.t`: a rule the user broke has to
  // be explained in the language they asked for.
  #assertPassword(password: string | undefined): asserts password is string {
    if (!password || password.length < 8) {
      throw new HttpError(422, "passwordTooShort", { field: "password" });
    }
  }

  #accessClaims(req: Request): TokenClaims | undefined {
    const header = req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) return undefined;
    return verify(this.ctx, header.slice(7), "access");
  }
}
