import { defineRoutes } from "../acl.module.js"
import { querySchema, paramsSchema } from "../schemas/public.schemas.js"
import * as PublicCtrls from "../controllers/public.controllers.js"

export const publicRoutes = defineRoutes((registry) => {

    // --- Collection routes: /categories ---
    const collection = registry.prefix("/categories")

    collection
        .require("categories:guest:list")
        .get("")
        .validate({ query: querySchema })
        .handle(PublicCtrls.listCategories)

    // --- Item routes: /categories/:categoryId ---
    const item = registry.prefix("/categories/:categoryId")

    item.param("categoryId", PublicCtrls.loadCategory)

    item
        .require("categories:guest:get")
        .get("")
        .validate({ params: paramsSchema })
        .handle(PublicCtrls.getCategory)
})
