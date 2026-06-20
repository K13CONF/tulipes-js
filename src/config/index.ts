import env from '@config/env.js'

export default (function resolveGlobalConfig() {

    return {
        app: {
            env: env.NODE_ENV,
            isDevelopment: env.NODE_ENV === 'development',
            isProduction: env.NODE_ENV === 'production',

            api: {
                prefix: '/api',
                version: 'v1'
            },

            lib: {
                server: {
                    port: parseInt(env.PORT, 10),
                    host: env.HOST
                },

                database: {
                    protocol: env.DATABASE_PROTOCOL,
                    host: env.DATABASE_HOST,
                    port: parseInt(env.DATABASE_PORT, 10),
                    name: env.DATABASE_NAME,
                    user: env.DATABASE_USER,
                    password: env.DATABASE_PASSWORD
                },

                jwt: {
                    secret: env.JWT_SECRET,
                    expiresIn: env.JWT_EXPIRES_IN
                },

                mailer: {
                    from: env.MAILER_FROM,
                    host: env.MAILER_HOST,
                    port: parseInt(env.MAILER_PORT, 10),
                    user: env.MAILER_AUTH_USER,
                    password: env.MAILER_AUTH_PASS,
                }
            }
        }
    }
})()