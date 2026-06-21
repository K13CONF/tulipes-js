import { defineRoutes } from "./acl.module.js";


defineRoutes((registry) => {

    // BO users list 
    registry
        .require("users:bo:list")
        .toPOST("/users")
        .use((req, res, next) => {
            if (req.url) {
                return next()
            } else
                return res.json({ ok: false })
        })
        .use((_, res) => {
            return res.status(200).json({
                ok: true
            })
        })


})