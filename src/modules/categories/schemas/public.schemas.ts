import { z } from "zod"

export const querySchema = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
})

export const paramsSchema = z.object({
    categoryId: z.string().min(1),
})
