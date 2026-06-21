
import { z } from "zod"

// Example validation schemas (query/params arrive as strings — coerce as needed)
const querySchema = z.object({
    page: z.coerce.number().min(1).default(1),
})
const bodySchema = z.object({
    name: z.string().min(1),
})


export {
    querySchema,
    bodySchema
}