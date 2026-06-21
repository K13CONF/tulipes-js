import defineRoutesFactory from "./define-routes.js";
import type { ACL } from "./types.js";

export default function defineACL(acl: ACL<string, Array<string>>) {
    return {
        acl: acl,
        defineRoutes: defineRoutesFactory(acl),
    }
}