/**
 * Module ACL (Access Control List) for Users
 * This file defines the access control rules for the Users module.
 * It specifies which roles have access to which resources and actions within the module.
 */

export async function getModuleACL() {

    return {
        admin: [
            "users:bo:list",
            "users:bo:get",
            "users:bo:create",
            "users:bo:update",
            "users:bo:delete"
        ],
        user: [
            "users:bo:list",
            "users:bo:get"
        ],
        sysadmin: [
            "users:bo:list",
            "users:bo:get",
            "users:bo:create",
            "users:bo:update",
            "users:bo:delete"
        ]
    };
}


