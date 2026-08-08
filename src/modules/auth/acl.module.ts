/**
 * Module ACL (Access Control List) for Auth.
 *
 * Credential endpoints (login, refresh, register) are granted to the public
 * role — they must work for unauthenticated callers (and `authorize()` gives
 * every authenticated caller the public grants on top of their own).
 * Token-bound endpoints (logout, me) require an authenticated role.
 */
import defineACL from "@packages/acl/define-acl.js"

const { acl, defineRoutes } = defineACL({
    public: [
        "auth:token:login",
        "auth:token:refresh",
        "auth:account:register",
    ],
    user: [
        "auth:token:logout",
        "auth:token:me",
    ],
    admin: [
        "auth:token:logout",
        "auth:token:me",
    ],
    sysadmin: [
        "auth:token:logout",
        "auth:token:me",
    ],
})

export {
    defineRoutes,
    acl,
}
