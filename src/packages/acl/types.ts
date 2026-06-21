/**
 * This file will contain types for the acl package
 */
import type { Role } from "@/config/roles.definition.js";

export type ACL<T extends Role['name'], K> = Record<T, Array<K>>

export type RAI<T extends string> = T 