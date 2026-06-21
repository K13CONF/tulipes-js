import defineRoutesFactory from "./define-routes.js"
import type { ACL, NoExcessRoles, RAIsOf } from "./types.js"

/**
 * Define a module's ACL.
 *
 * Role keys are constrained to the roles declared in `roles.definition`: any
 * unknown role key is a compile-time error. The `const` type parameter
 * preserves the RAI string literals so the returned `defineRoutes` is typed
 * with exactly this module's RAIs — making `registry.require(...)` autocomplete
 * and reject unknown identifiers.
 *
 * @example
 * const { acl, defineRoutes } = defineACL({
 *     admin: ["users:bo:list", "users:bo:get"],
 *     user:  ["users:bo:list"],
 * })
 */
export default function defineACL<const A extends ACL>(acl: NoExcessRoles<A>) {
    // `acl` is narrowed to NoExcessRoles<A> for caller-side checking; the
    // underlying runtime value is just `A`.
    const value = acl as A

    return {
        acl: value,
        defineRoutes: defineRoutesFactory<RAIsOf<A>>(value),
    }
}
