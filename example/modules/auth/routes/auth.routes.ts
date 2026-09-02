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
import { requirePermission } from "../helpers/guards.js";

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
  configurePassport(ctx);

  ctx.app!.use(passport.initialize());
  ctx.app!.use(authenticate());

  const router = Router();
  const base = `${String(ctx.config.api?.prefix ?? "")}/auth`;
  const may = (permission: string) => requirePermission(ctx, permission);

  router.post(`${base}/register`, may("auth:register"), register(ctx));
  router.post(`${base}/login`, may("auth:login"), login(ctx));
  router.post(`${base}/refresh`, may("auth:refresh"), refresh(ctx));
  router.post(`${base}/logout`, may("auth:logout"), logout(ctx));
  router.get(`${base}/me`, may("auth:me"), me());
  router.post(`${base}/password`, may("auth:password"), changePassword(ctx));

  return router;
}
