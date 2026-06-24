import defineACL from "@packages/acl/define-acl.js"

const { acl, defineRoutes } = defineACL({
    sysadmin: [
        "categories:bo:list",
        "categories:bo:get",
        "categories:bo:create",
        "categories:bo:update",
        "categories:bo:delete",
    ],
    admin: [
        "categories:bo:list",
        "categories:bo:get",
        "categories:bo:create",
        "categories:bo:update",
        "categories:bo:delete",
    ],
    user: [
        "categories:bo:list",
        "categories:bo:get",
    ],
    public: [
        "categories:guest:list",
        "categories:guest:get",
    ],
})

export { acl, defineRoutes }
