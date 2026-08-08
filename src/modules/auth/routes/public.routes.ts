import { defineRoutes } from "../acl.module.js"
import { authRateLimiter } from "@lib/security.js"
import type { RouteMiddleware } from "@packages/acl/define-routes.js"
import { loginSchema, refreshSchema, registerSchema } from "../schemas/public.schemas.js"
import * as PublicCtrls from "../controllers/public.controllers.js"

// The stricter per-IP limiter guards the brute-force surface (credentials and
// token grinding). Deliberately NOT on /me — front-ends poll it freely.
const throttled = authRateLimiter as unknown as RouteMiddleware

export const publicRoutes = defineRoutes((registry) => {
    const auth = registry.prefix("/auth")

    auth.require("auth:token:login")
        .post("/login")
        .use(throttled)
        .validate({ body: loginSchema })
        .handle(PublicCtrls.login)

    auth.require("auth:token:refresh")
        .post("/refresh")
        .use(throttled)
        .validate({ body: refreshSchema })
        .handle(PublicCtrls.refresh)

    auth.require("auth:account:register")
        .post("/register")
        .use(throttled)
        .validate({ body: registerSchema })
        .handle(PublicCtrls.register)

    auth.require("auth:token:logout")
        .post("/logout")
        .handle(PublicCtrls.logout)

    auth.require("auth:token:me")
        .get("/me")
        .handle(PublicCtrls.me)
})
