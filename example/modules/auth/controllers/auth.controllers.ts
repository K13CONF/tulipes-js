import passport from "passport";
import type { Request, RequestHandler, Response } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";

import { principal } from "../helpers/principal.js";
import type { UserDoc } from "../helpers/documents.js";
import { setPassword } from "../helpers/passwords.js";
import {
  consumeRefresh,
  issuePair,
  revokeAccess,
  verify,
  type TokenClaims,
} from "../helpers/tokens.js";

interface Credentials {
  email?: string;
  password?: string;
}

/** POST /auth/register — creates the account and its credential. */
export function register(ctx: Ctx): RequestHandler {
  return async (req: Request, res: Response) => {
    const { email, password } = (req.body ?? {}) as Credentials;
    if (!email || !password) {
      throw new HttpError(422, "email and password are required");
    }
    if (password.length < 8) {
      throw new HttpError(422, "password must be at least 8 characters");
    }
    if (ctx.config.users?.signupMode !== "open") {
      throw new HttpError(403, `registration is ${ctx.config.users?.signupMode ?? "closed"}`);
    }

    const User = ctx.models!.get<UserDoc>("User");
    const normalised = email.toLowerCase();
    if (await User.countDocuments({ email: normalised }).limit(1)) {
      // Deliberately the same shape as any other validation failure: a
      // different message here would turn registration into an oracle for
      // which addresses have accounts.
      throw new HttpError(422, "that email cannot be registered");
    }

    const user = await User.create({ email: normalised, role: "user" });
    await setPassword(ctx, String(user._id), password);

    const tokens = await issuePair(ctx, String(user._id));
    res.status(201).json({ user: { id: String(user._id), email: normalised, role: "user" }, ...tokens });
  };
}

/** POST /auth/login — passport-local checks the password, then we mint. */
export function login(ctx: Ctx): RequestHandler {
  return (req, res, next) => {
    passport.authenticate(
      "local",
      { session: false },
      async (error: unknown, user: { _id: unknown; email: string; role: string } | false) => {
        if (error) return next(error);
        // One message for "no such user" and "wrong password" alike.
        if (!user) return next(new HttpError(401, "invalid email or password"));

        try {
          const tokens = await issuePair(ctx, String(user._id));
          res.json({
            user: { id: String(user._id), email: user.email, role: user.role },
            ...tokens,
          });
        } catch (issueError) {
          next(issueError);
        }
      },
    )(req, res, next);
  };
}

/** POST /auth/refresh — rotates the pair. */
export function refresh(ctx: Ctx): RequestHandler {
  return async (req, res) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };
    if (!refreshToken) throw new HttpError(422, "refreshToken is required");

    const claims = verify(ctx, refreshToken, "refresh");
    if (!claims) throw new HttpError(401, "invalid refresh token");

    // Rotation: the old jti is consumed here, so the same refresh token
    // cannot be exchanged twice.
    if (!(await consumeRefresh(ctx, claims.jti))) {
      throw new HttpError(401, "refresh token already used or revoked");
    }

    const user = await ctx.models!.get<UserDoc>("User").findById(claims.sub).lean();
    if (!user) throw new HttpError(401, "account no longer exists");

    res.json(await issuePair(ctx, claims.sub));
  };
}

/** POST /auth/logout — ends this session immediately. */
export function logout(ctx: Ctx): RequestHandler {
  return async (req, res) => {
    const who = principal(req);
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };

    // Drop the refresh token so it cannot be rotated…
    if (refreshToken) {
      const claims = verify(ctx, refreshToken, "refresh");
      if (claims) await consumeRefresh(ctx, claims.jti);
    }

    // …and blacklist the access token, so it stops working now rather than
    // when it expires.
    const header = req.header("authorization") ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    const access = bearer ? (verify(ctx, bearer, "access") as TokenClaims | undefined) : undefined;
    if (access) await revokeAccess(ctx, access);

    res.json({ loggedOut: true, user: who.id });
  };
}

/** GET /auth/me — the principal the request pipeline resolved. */
export function me(): RequestHandler {
  return (req, res) => {
    const { id, email, role } = principal(req);
    res.json({ id, email, role });
  };
}

/** POST /auth/password — change own password, ending every other session. */
export function changePassword(ctx: Ctx): RequestHandler {
  return async (req, res) => {
    const who = principal(req);
    const { password } = (req.body ?? {}) as { password?: string };
    if (!password || password.length < 8) {
      throw new HttpError(422, "password must be at least 8 characters");
    }

    await setPassword(ctx, who.id!, password);

    // Every previous token is now dead, including the one that made this
    // request. Handing back a fresh pair keeps the client that just
    // changed its password signed in, while every other device is out.
    const tokens = await issuePair(ctx, who.id!);
    res.json({ changed: true, sessionsRevoked: true, ...tokens });
  };
}
