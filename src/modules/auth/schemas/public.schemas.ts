import { z } from "zod"

/** Login: one identifier field — Authenticable matches it against every
 *  registered model's username fields (email, username, …). */
export const loginSchema = z.strictObject({
    identifier: z.string().min(1),
    password: z.string().min(1),
})

/** Refresh: the refresh token, always sent in the body. */
export const refreshSchema = z.strictObject({
    refreshToken: z.string().min(1),
})

/** Register: password floor follows NIST — length over composition rules. */
export const registerSchema = z.strictObject({
    email: z.email(),
    username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    password: z.string().min(12).max(128),
    first_name: z.string().min(1).max(64).optional(),
    last_name: z.string().min(1).max(64).optional(),
})
