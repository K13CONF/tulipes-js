import type { RouteMiddleware, RouteHandler } from "@packages/acl/define-routes.js"
import type { z } from "zod"
import { paramsSchema, querySchema } from "../schemas/public.schemas.js"

type Params = z.infer<typeof paramsSchema>
type Query = z.infer<typeof querySchema>

// ---------------------------------------------------------------------------
// Param pre-handler
// ---------------------------------------------------------------------------

export const loadCategory: RouteMiddleware<Params> = (req, _res, next) => {
    const { categoryId } = req.params
    if (!categoryId) return next(new Error("Category not found"))
    next()
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export const listCategories: RouteHandler<Record<string, string>, unknown, Query> = (req, res) => {
    const { page, limit } = req.query
    return res.status(200).json({ ok: true, data: [], meta: { page, limit } })
}

export const getCategory: RouteHandler<Params> = (req, res) => {
    const { categoryId } = req.params
    return res.status(200).json({ ok: true, data: { id: categoryId } })
}
