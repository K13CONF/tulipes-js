import { defineRoutes } from "../acl.module.js"
import { querySchema, paramsSchema, bodySchema } from "../schemas/bo.schemas.js"
import * as BOCtrls from "../controllers/bo.controllers.js"

export const boRoutes = defineRoutes((registry) => {

    // --- Collection routes: /categories ---
    const collection = registry.prefix("/categories")

    collection
        .require("categories:bo:list")
        .get("")
        .validate({ query: querySchema })
        .handle(BOCtrls.listCategories)

    collection
        .require("categories:bo:create")
        .post("")
        .validate({ body: bodySchema })
        .handle(BOCtrls.createCategory)

    // --- Item routes: /categories/:categoryId (nested under the collection) ---
    const item = collection.prefix("/test")

    // loadCategory runs before every item route
    item.param("categoryId", BOCtrls.loadCategory)

    item
        .require("categories:bo:get")
        .get("/:categoryId")
        .validate({ params: paramsSchema })
        .handle(BOCtrls.getCategory)


    item
        .require("categories:bo:update")
        .put("")
        .validate({ params: paramsSchema, body: bodySchema })
        .handle(BOCtrls.updateCategory)

    item
        .require("categories:bo:delete")
        .delete("")
        .validate({ params: paramsSchema })
        .handle(BOCtrls.deleteCategory)

    const fin = registry.finalize()
    console.log(fin)
})
