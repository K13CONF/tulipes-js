import { Router } from "express";
import passport from "passport";
import type { Ctx } from "@tulipes/core/boot";

import { AuthController } from "../controllers/auth.controllers.js";
import { authenticate, configurePassport } from "../helpers/passport.js";

/**
 * Auth is a sys-tier module, so this runs before every feature router.
 * It does two things:
 *
 *   1. mounts the global caller resolver on ctx.app — every request
 *      downstream carries a `req.auth` of `{ isAuthenticated, user,
 *      session }`, the guest value when unauthenticated
 *   2. returns its own endpoints as a Router, like any other module
 *
 * Every route declares a RAI. The id is also the ACL permission, so login
 * is reachable because `guest` holds "auth:login" in module.acl.ts — and
 * core refuses to boot if any route forgets to declare one.
 */
export default function authRoutes(ctx: Ctx): Router {
  const { rai } = ctx;
  configurePassport(ctx);

  ctx.app!.use(passport.initialize());
  ctx.app!.use(authenticate());

  const router = Router();
  const auth = new AuthController(ctx);
  const base = `${String(ctx.config.api?.prefix ?? "")}/auth`;

  router.post(
    `${base}/register`,
    rai({
      id: "auth:register",
      name: "Register",
      description: "Create an account and its credential",
    }),
    auth.register(),
  );

  router.post(
    `${base}/login`,
    rai({
      id: "auth:login",
      name: "Log in",
      description: "Exchange email and password for a token pair",
    }),
    auth.login(),
  );

  router.post(
    `${base}/refresh`,
    rai({
      id: "auth:refresh",
      name: "Refresh tokens",
      description: "Rotate a refresh token for a new pair",
    }),
    auth.refresh(),
  );

  router.post(
    `${base}/logout`,
    rai({
      id: "auth:logout",
      name: "Log out",
      description: "Revoke this session immediately",
    }),
    auth.logout(),
  );

  router.get(
    `${base}/me`,
    rai({
      id: "auth:me",
      name: "Who am I",
      description: "The caller and the session behind this request",
    }),
    auth.me(),
  );

  router.get(
    `${base}/sessions`,
    rai({
      id: "auth:sessions",
      name: "List sessions",
      description: "Every device this account is signed in on",
    }),
    auth.sessions(),
  );

  router.delete(
    `${base}/sessions/:sid`,
    rai({
      id: "auth:session-end",
      name: "End a session",
      description: "Sign one other device out",
    }),
    auth.revokeSession(),
  );

  router.post(
    `${base}/password`,
    rai({
      id: "auth:password",
      name: "Change password",
      description: "Set a new password and end every other session",
    }),
    auth.changePassword(),
  );

  return router;
}
