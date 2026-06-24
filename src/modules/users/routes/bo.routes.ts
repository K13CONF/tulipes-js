import { defineRoutes } from "../acl.module.js"
import { bodySchema, querySchema, paramsSchema } from "../schemas/bo.schemas.js";

import * as BOCtrls from "../controllers/bo.controllers.js"

export const boRoutes = defineRoutes((registry) => {


    // BO users list
    registry
        .require("users:bo:list")
        .post("/users")
        .use((req, res, next) => {
            if (req.url) {
                return next()
            } else {
                return res.respond(null, { status: 400 })
            }
        })
        .handle((_req, res) => {
            return res.respond({ created: true }, { status: 201 })
        })

    registry
        .require("users:bo:list")
        .get("/users")
        .validate({
            query: querySchema,
            body: bodySchema,
        })
        .use((req, _res, next) => {
            // req.query.page is `number`, req.body.name is `string` (typed by validate)
            if (req.query.page > 0 && req.body.name) {
                return next()
            } else {
                return next(new Error("invalid"))
            }
        })
        .handle((req, res) => {
            return res.respond({ page: req.query.page, name: req.body.name })
        })


    registry
        .require("users:guest:get")
        .get("/users/:userId")
        .validate({
            query: querySchema,
            body: bodySchema,
            params: paramsSchema,
        })
        .use(BOCtrls.getUserById)
        .handle(BOCtrls.respondWithUser)

    registry
        .require("users:guest:list")
        .get("/users/public")
        .validate({
            query: querySchema,
        })
        .use((req, _res, next) => {
            // req.query.page is `number`, req.body.name is `string` (typed by validate)
            if (req.query.page > 0) {
                return next()
            } else {
                return next(new Error("invalid"))
            }
        })
        .handle((req, res) => {
            return res.respond({ page: req.query.page })
        })
})
