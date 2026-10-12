import { Router } from "express";
import passport from "passport";
import type { BackendCtx } from "@tulipes/core/boot";
import { lazy } from "@app/core";

import { WebAuthController } from "../controllers/web.auth.controllers.ts";
import { authenticate, configurePassport } from "../helpers/passport.ts";
import {
  credentials,
  newPassword,
  refreshBody,
  registration,
  sidParam,
  tokenPair,
} from "../schemas/auth.schemas.ts";

/**
 * Every endpoint here serves the client-facing surface, so the file is
 * named scope-first (`web.auth.routes.ts`) and every id is `auth:web:…`.
 * A back-office surface would sit beside it as `bo.auth.routes.ts`.
 */
export default function authRoutes(ctx: BackendCtx): void {
  const { app, rai, routes, config } = ctx;
  const auth = new WebAuthController(ctx);

  // Passport reads the signing keys when it is configured, so it is
  // configured on the first request, after which every request is identified
  // before any feature route runs.
  app.use(lazy(() => {
    configurePassport(ctx);
    return passport.initialize();
  }));
  app.use(lazy(() => authenticate()));

  const router = Router();

  router.post("/register", rai({
      id: "auth:web:register",
      status: 201,
      name: "Register",
      description: "Create an account and its credential",
      body: registration,
    }), auth.register());

  router.post("/login", rai({
      id: "auth:web:login",
      name: "Log in",
      description: "Exchange email and password for a token pair",
      body: credentials,
      returns: tokenPair,
    }), auth.login());

  router.post("/refresh", rai({
      id: "auth:web:refresh",
      name: "Refresh tokens",
      description: "Rotate a refresh token for a new pair",
      body: refreshBody,
      returns: tokenPair,
    }), auth.refresh());

  router.post("/logout", rai({
      id: "auth:web:logout",
      name: "Log out",
      description: "Revoke this session immediately",
    }), auth.logout());

  router.get("/me", rai({
      id: "auth:web:me",
      name: "Who am I",
      description: "The caller and the session behind this request",
    }), auth.me());

  router.get("/sessions", rai({
      id: "auth:web:sessions",
      name: "List sessions",
      description: "Every device this account is signed in on",
      // These two are auth's, but they answer a different question from
      // signing in — `folder` puts them under their own heading in the
      // generated collection and spec.
      folder: "sessions",
    }), auth.sessions());

  router.delete("/sessions/:sid", rai({
      id: "auth:web:sessions:end",
      name: "End a session",
      description: "Sign one other device out",
      folder: "sessions",
      params: sidParam,
    }), auth.revokeSession());

  router.post("/password", rai({
      id: "auth:web:password",
      name: "Change password",
      description: "Set a new password and end every other session",
      body: newPassword,
    }), auth.changePassword());

  routes.mount(router, `${config.api!.prefix}/auth`);
}
