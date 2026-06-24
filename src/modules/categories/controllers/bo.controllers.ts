import type { RouteMiddleware, RouteHandler } from "@packages/acl/define-routes.js"
import type { z } from "zod"
import { paramsSchema, querySchema, bodySchema } from "../schemas/bo.schemas.js"

type Params = z.infer<typeof paramsSchema>
type Body = z.infer<typeof bodySchema>
type Query = z.infer<typeof querySchema>

// ---------------------------------------------------------------------------
// Param pre-handler — runs before every route that has :categoryId in its path
// ---------------------------------------------------------------------------

export const loadCategory: RouteMiddleware<Params> = (req, _res, next) => {
    const { categoryId } = req.params
    // TODO: load category from DB and attach to req (e.g. req.category = ...)
    // For now just validate it looks like a valid id and forward.
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

export const createCategory: RouteHandler<Record<string, string>, Body> = (req, res) => {
    const { name, description } = req.body
    return res.status(201).json({ ok: true, data: { id: "new-id", name, description } })
}

export const updateCategory: RouteHandler<Params, Body> = (req, res) => {
    const { categoryId } = req.params
    const { name, description } = req.body
    return res.status(200).json({ ok: true, data: { id: categoryId, name, description } })
}

export const deleteCategory: RouteHandler<Params> = (req, res) => {
    const { categoryId } = req.params
    return res.status(200).json({ ok: true, data: { id: categoryId } })
}
