import { z } from "zod"
import roles from "@config/roles.definition.js"

/**
 * This file defines the zod schema used to validate the ACL (Access Control
 * List) declared by each module before it is merged into the global config
 * (see `resolveModulesACLs` in `@config/index.ts`).
 */

// Set of valid role names — an ACL may only grant permissions to known roles.
const roleNames = new Set(roles.map((role) => role.name))

/**
 * A single permission string, in the form "module:resource:action"
 * e.g. "users:bo:list".
 */
export const permissionSchema = z
    .string()
    .regex(
        /^[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+$/i,
        'Permission must be in the form "module:resource:action"'
    )

/**
 * A module's ACL: maps a role name to the list of permissions granted to it.
 * Keys must reference roles defined in roles.definition.
 */
export const moduleACLSchema = z
    .record(z.string(), z.array(permissionSchema))
    .superRefine((acl, ctx) => {
        for (const role of Object.keys(acl)) {
            if (!roleNames.has(role)) {
                ctx.addIssue({
                    code: "custom",
                    message: `Unknown role "${role}" — not defined in roles.definition`,
                    path: [role]
                })
            }
        }
    })

export type Permission = z.infer<typeof permissionSchema>
export type ModuleACL = z.infer<typeof moduleACLSchema>
