import { defineRoutes } from "./acl.module.js";


defineRoutes((registry) => {

    registry
    .require("user:bo:list")
    .toPOST("/users/:userId")
    .use((req, res, next) => {

    })
    .use((req, res, next) => {

    })
    .use((req, res, next) => {

    })


})