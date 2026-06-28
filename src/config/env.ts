import { config } from 'dotenv'
import { z } from 'zod'
import path from 'path'
import type { StringValue } from 'ms'

// Get the runtime environment, fallback on development
const { NODE_ENV = 'development' } = process.env;


// Load the env file
const envFilePath = `./.envs/.env.${NODE_ENV}`
config({
    path: envFilePath
})


const envSchema = z.object({
    // Runtime environment variables
    NODE_ENV: z.enum(['development', 'staging', 'production', 'test']),

    // Server configuration
    PORT: z.string(),
    HOST: z.string(),

    // Security configuration
    CORS_ORIGINS: z.string().default(""), // csv allowlist; "" = none, "*" = any (dev only)
    CORS_CREDENTIALS: z.enum(["true", "false"]).default("false"), // allow cookies/Authorization cross-origin
    TRUST_PROXY: z.string().default("false"), // false | true | <hops> | "loopback" — behind nginx/ALB set to hop count
    BODY_LIMIT: z.string().default("100kb"), // max JSON body size
    RATE_LIMIT_WINDOW_MS: z.string().default("60000"), // rate-limit window
    RATE_LIMIT_MAX: z.string().default("100"), // max requests per IP per window (global)
    RATE_LIMIT_AUTH_MAX: z.string().default("10"), // stricter cap for auth routes


    // Database configuration
    DATABASE_PROTOCOL: z.string(),
    DATABASE_HOST: z.string(),
    DATABASE_PORT: z.string(),
    DATABASE_NAME: z.string(),
    DATABASE_USER: z.string(),
    DATABASE_PASSWORD: z.string(),

    // JWT configuration
    JWT_ALGORITHM: z.enum(['HS256', 'RS256', 'ES256']).default('RS256'),
    JWT_PRIVATE_KEY: z.string(), // Private key for RS256 or ES256 algorithms. Also used for HS256 if you want to use a custom secret.
    JWT_PUBLIC_KEY: z.string(), // Public key for RS256 or ES256 algorithms
    JWT_EXPIRES_IN: z.custom<StringValue>((val) => typeof val === "string" && /^\d+\s*[a-zA-Z]*$/.test(val)), // e.g. "1h", "7d", "30d"
    JWT_REFRESH_EXPIRES_IN: z.custom<StringValue>((val) => typeof val === "string" && /^\d+\s*[a-zA-Z]*$/.test(val)), // e.g. "1h", "7d", "30d"

    // Redis configuration (shared cache client + BullMQ connections)
    REDIS_HOST: z.string(),
    REDIS_PORT: z.string(),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_DB: z.string().default('0'),

    // Queue worker configuration
    WORKER_INLINE: z.enum(["true", "false"]).default("false"), // run the queue worker inside the web process (dev convenience)
    WORKER_CONCURRENCY: z.string().default("5"), // max jobs a worker processes concurrently

    // Email configuration
    MAILER_FROM: z.string(),
    MAILER_HOST: z.string(),
    MAILER_PORT: z.string(),
    MAILER_SECURE: z.enum(["true", "false"]).default("false"),
    MAILER_AUTH_USER: z.string(),
    MAILER_AUTH_PASS: z.string(),
    MAILER_QUEUE_ENABLED: z.enum(["true", "false"]).default("true"), // enqueue mail via BullMQ instead of sending inline
    MAILER_LOGGING_ENABLED: z.enum(["true", "false"]).default("false"), // nodemailer transport logging

    // Logging configuration (optional — sensible defaults applied in the logger)
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
    LOG_DIR: z.string().default('./logs'),
    LOG_TO_FILE: z.enum(['true', 'false']).optional(),

    // i18n configuration (optional — sensible defaults applied in the i18n lib)
    I18N_FALLBACK_LANGUAGE: z.string().default('en'),
    I18N_SUPPORTED_LANGUAGES: z.string().default('en'), // comma-separated, e.g. "en,fr,ar"
    I18N_DEFAULT_NAMESPACE: z.string().default('core')
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