import { Router } from "express";
import passport from "passport";
import type { Ctx } from "@tulipes/core/boot";

import {
  changePassword,
  login,
  logout,
  me,
  refresh,
  register,
} from "../controllers/auth.controllers.js";
import { authenticate, configurePassport } from "../helpers/passport.js";

/**
 * Auth is a sys-tier module, so this runs before every feature router.
 * It does two things:
 *
 *   1. mounts the global principal resolver on ctx.app — every request
 *      downstream has a `req.principal`, `guest` when unauthenticated
 *   2. returns its own endpoints as a Router, like any other module
 *
 * Each endpoint names a permission rather than being implicitly public.
 * Login is reachable because `guest` is granted `auth:login` in
 * module.acl.ts — one mechanism, visible in one place.
 */
export default function authRoutes(ctx: Ctx): Router {
  const { rai } = ctx;
  configurePassport(ctx);

  ctx.app!.use(passport.initialize());
  ctx.app!.use(authenticate());

  const router = Router();
  const base = `${String(ctx.config.api?.prefix ?? "")}/auth`;

  router.post(
    `${base}/register`,
    rai({ id: "auth:register", name: "Register", description: "Create an account and its credential" }),
    register(ctx),
  );
  router.post(
    `${base}/login`,
    rai({ id: "auth:login", name: "Log in", description: "Exchange email and password for a token pair" }),
    login(ctx),
  );
  router.post(
    `${base}/refresh`,
    rai({ id: "auth:refresh", name: "Refresh tokens", description: "Rotate a refresh token for a new pair" }),
    refresh(ctx),
  );
  router.post(
    `${base}/logout`,
    rai({ id: "auth:logout", name: "Log out", description: "Revoke this session immediately" }),
    logout(ctx),
  );
  router.get(
    `${base}/me`,
    rai({ id: "auth:me", name: "Current principal", description: "Who the request pipeline resolved" }),
    me(),
  );
  router.post(
    `${base}/password`,
    rai({ id: "auth:password", name: "Change password", description: "Set a new password and end every other session" }),
    changePassword(ctx),
  );

  return router;
}
