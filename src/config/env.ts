import { config } from 'dotenv'
import { z } from 'zod'
import path from 'path'

// Get the runtime environment, fallback on development
const { NODE_ENV = 'development' } = process.env;


// Load the env file
const envFilePath = `./.envs/.env.${NODE_ENV}`
config({
    path: envFilePath
})


const envSchema = z.object({
    // Runtime environment variables
    NODE_ENV: z.enum(['development', 'production', 'test']),

    // Server configuration
    PORT: z.string(),
    HOST: z.string(),
    HTTPS_ENABLED: z.enum(["true", "false"]).default("false"),
    CLUSTER_MODE_ENABLED: z.enum(["true", "false"]).default("false"),


    // Database configuration
    DATABASE_PROTOCOL: z.string(),
    DATABASE_HOST: z.string(),
    DATABASE_PORT: z.string(),
    DATABASE_NAME: z.string(),
    DATABASE_USER: z.string(),
    DATABASE_PASSWORD: z.string(),

    // JWT configuration
    JWT_SECRET: z.string(),
    JWT_EXPIRES_IN: z.string(),

    // Email configuration
    MAILER_FROM: z.string(),
    MAILER_HOST: z.string(),
    MAILER_PORT: z.string(),
    MAILER_SECURE: z.string(),
    MAILER_AUTH_USER: z.string(),
    MAILER_AUTH_PASS: z.string(),

    // Logging configuration (optional — sensible defaults applied in the logger)
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
    LOG_DIR: z.string().default('./logs'),
    LOG_TO_FILE: z.enum(['true', 'false']).optional()
})

let env: z.infer<typeof envSchema>;

try {
    // Validate the environment variables
    env = envSchema.parse(process.env)

} catch (error) {
    if (!(error instanceof z.ZodError)) {
        console.error('❌ Unexpected error while validating environment variables:', error)
        process.exit(1);
    }
    if (!(error.issues.length > 0)) {
        console.error('❌ Unexpected error while validating environment variables:', error)
        process.exit(1);
    }

    console.error(`❌ Invalid environment variables (file://${path.resolve(envFilePath)}):`)
    error.issues?.forEach(issue => {
        console.error(`   ${issue.path.join('.')} ${issue.message}`)
    });
    process.exit(1)
}

export default env