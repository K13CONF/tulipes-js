import { z } from "zod/v4";

/**
 * Shapes for the users endpoints. Declared once and used twice: `rai()`
 * validates the request against them, and `tulipes spec` describes them
 * in the generated OpenAPI document and Postman collection — so the
 * documentation can never claim a shape the endpoint would reject.
 *
 * zod/v4, not the classic import: `z.toJSONSchema` is what the generator
 * uses, and it only understands v4 schemas.
 */
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
});

export const createBody = z.object({
  // The message doubles as an i18n key: the error handler translates it
  // in this module's namespace, and falls back to the text as written.
  email: z.email("emailInvalid"),
});

export const emailParam = z.object({
  email: z.email("emailInvalid"),
});

export const userShape = z.object({
  email: z.string(),
  role: z.string(),
});
