import type { RouteMiddleware, RouteHandler } from "@/packages/acl/define-routes.js"
import type { z } from "zod"
import { paramsSchema, querySchema, bodySchema } from "../schemas/bo.schemas.js"

type P = z.infer<typeof paramsSchema>
type B = z.infer<typeof bodySchema>
type Q = z.infer<typeof querySchema>

export const getUserById: RouteMiddleware<P, B, Q> = (req, _res, next) => {
    const userId = req.params.userId
    next()
}

export const respondWithUser: RouteHandler<P, B, Q> = (req, res) => {
    return res.status(200).json({ userId: req.params.userId })
}