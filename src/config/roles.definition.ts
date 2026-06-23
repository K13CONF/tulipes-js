import { z } from 'zod'

/**
 * This file defines the roles used in the application.
 * Each role has a name, description, and a flag indicating whether it is a system role.
 */

/**
 * The canonical list of role names. Single source of truth for both the
 * runtime zod validation and the compile-time `RoleName` union consumed across
 * the ACL system (`defineACL`, `RAIsOf`, etc.).
 */
export const ROLE_NAMES = ['sysadmin', 'admin', 'user', 'public'] as const

/** Union of all defined role names, e.g. "sysadmin" | "admin" | "user". */
export type RoleName = (typeof ROLE_NAMES)[number]

// Shape a single role must satisfy
const roleSchema = z.object({
    name: z.enum(ROLE_NAMES),
    description: z.string(),
    isSystem: z.boolean(),
    // Marks the default/fallback role applied when a request has no role in its
    // auth context (the "public" / guest role). Defaults to false.
    isPublic: z.boolean().optional().default(false)
})

// The full roles definition: an array of roles with unique names
const rolesSchema = z.array(roleSchema).refine(
    (roles) => new Set(roles.map((role) => role.name)).size === roles.length,
    { message: 'Duplicate role names are not allowed' }
)

export type Role = z.infer<typeof roleSchema>

// The actual roles defined for the application
const rolesDefinition = [
    {
        name: 'sysadmin',
        description: 'System administrator role with full access to all resources',
        isSystem: true,
        isPublic: false
    },
    {
        name: 'admin',
        description: 'Administrator role with full access to all resources',
        isSystem: false,
        isPublic: false
    },
    {
        name: 'user',
        description: 'Regular user role with limited access to resources',
        isSystem: false,
        isPublic: false
    },
    {
        name: 'public',
        description: 'Public role has access to public resources',
        isSystem: false,
        isPublic: true
    }
]

let roles: Role[];

try {
    // Validate the roles definition
    roles = rolesSchema.parse(rolesDefinition)

} catch (error) {
    if (!(error instanceof z.ZodError)) {
        console.error('❌ Unexpected error while validating roles definition:', error)
        process.exit(1);
    }
    if (!(error.issues.length > 0)) {
        console.error('❌ Unexpected error while validating roles definition:', error)
        process.exit(1);
    }

    console.error(`❌ Invalid roles definition:`)
    error.issues?.forEach(issue => {
        console.error(`❌ ${issue.path.join('.')} ${issue.message}`)
    });
    process.exit(1)
}

/**
 * Names of the roles flagged `isPublic` — the default fallback roles applied to
 * a request that carries no role in its auth context. Usually a single role
 * ("public" / guest).
 */
export const publicRoleNames: string[] = roles.filter((role) => role.isPublic).map((role) => role.name)

export default roles
