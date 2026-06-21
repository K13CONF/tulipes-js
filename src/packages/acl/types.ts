/**
 * Core types for the ACL package.
 */
import type { RoleName } from "@/config/roles.definition.js"

export type { RoleName }

/**
 * A Resource Access Identifier (RAI) — a permission string in the form
 * "module:resource:action", e.g. "users:bo:list".
 */
export type RAI = string

/**
 * The base shape of a module ACL: maps a (subset of) roles to the RAIs granted
 * to them. Used as the generic constraint in `defineACL`.
 */
export type ACL = Partial<Record<RoleName, readonly RAI[]>>

/**
 * Forces any key of `A` that is not a known `RoleName` to `never`, turning an
 * undeclared role key into a compile-time error while still inferring `A`.
 */
export type NoExcessRoles<A> = A & Record<Exclude<keyof A, RoleName>, never>

/**
 * Union of every RAI literal declared across all roles of an ACL object `A`.
 * This is what powers `registry.require(...)` autocompletion.
 */
export type RAIsOf<A> = A[keyof A] extends readonly (infer R)[]
    ? R extends string
        ? R
        : never
    : never
