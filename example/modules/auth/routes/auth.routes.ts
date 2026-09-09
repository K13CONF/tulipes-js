import { Router } from "express";
import { defineRoutes } from "@tulipes/core/http";
import { apiPrefix } from "../../../config/routes.js";
import {
  credentials,
  newPassword,
  refreshBody,
  registration,
  sidParam,
  tokenPair,
} from "../schemas.js";

export default defineRoutes(({ app, rai, routes, runtime }) => {
  const router = Router();
  const auth = runtime(async ctx => {
    const { AuthController } = await import("../controllers/auth.controllers.js");
    const { authenticate, configurePassport } = await import("../helpers/passport.js");
    const { default: passport } = await import("passport");
    configurePassport(ctx);
    return { controller: new AuthController(ctx), initialize: passport.initialize(), authenticate: authenticate() };
  });
  app.use(auth(value => value.initialize));
  app.use(auth(value => value.authenticate));

  router.post("/register", rai({
      id: "auth:register",
      status: 201,
      name: "Register",
      description: "Create an account and its credential",
      body: registration,
    }), auth(value => value.controller.register()));

  router.post("/login", rai({
      id: "auth:login",
      name: "Log in",
      description: "Exchange email and password for a token pair",
      body: credentials,
      returns: tokenPair,
    }), auth(value => value.controller.login()));

  router.post("/refresh", rai({
      id: "auth:refresh",
      name: "Refresh tokens",
      description: "Rotate a refresh token for a new pair",
      body: refreshBody,
      returns: tokenPair,
    }), auth(value => value.controller.refresh()));

  router.post("/logout", rai({
      id: "auth:logout",
      name: "Log out",
      description: "Revoke this session immediately",
    }), auth(value => value.controller.logout()));

  router.get("/me", rai({
      id: "auth:me",
      name: "Who am I",
      description: "The caller and the session behind this request",
    }), auth(value => value.controller.me()));

  router.get("/sessions", rai({
      id: "auth:sessions",
      name: "List sessions",
      description: "Every device this account is signed in on",
      // These two are auth's, but they answer a different question from
      // signing in — `folder` puts them under their own heading in the
      // generated collection and spec.
      folder: "sessions",
    }), auth(value => value.controller.sessions()));

  router.delete("/sessions/:sid", rai({
      id: "auth:session-end",
      name: "End a session",
      description: "Sign one other device out",
      folder: "sessions",
      params: sidParam,
    }), auth(value => value.controller.revokeSession()));

  router.post("/password", rai({
      id: "auth:password",
      name: "Change password",
      description: "Set a new password and end every other session",
      body: newPassword,
    }), auth(value => value.controller.changePassword()));

  routes.mount(app, `${apiPrefix}/auth`, router);
});
