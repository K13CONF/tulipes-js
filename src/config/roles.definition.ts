import { z } from 'zod'

/**
 * This file defines the roles used in the application.
 * Each role has a name, description, and a flag indicating whether it is a system role.
 */

// Shape a single role must satisfy
const roleSchema = z.object({
    name: z.string(),
    description: z.string(),
    isSystem: z.boolean()
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
        isSystem: true
    },
    {
        name: 'admin',
        description: 'Administrator role with full access to all resources',
        isSystem: false
    },
    {
        name: 'user',
        description: 'Regular user role with limited access to resources',
        isSystem: false
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

export default roles
