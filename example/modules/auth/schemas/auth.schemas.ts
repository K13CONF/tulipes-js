import { z } from "zod/v4";
import { isGrant } from "@tulipes/core/acl";

/**
 * Request shapes for the auth endpoints, used twice from one declaration:
 * `rai()` validates against them, and `tulipes spec` describes them.
 *
 * Messages are i18n keys — the error handler translates them in this
 * module's namespace, so a rejected field speaks the caller's language.
 */
export const credentials = z.object({
  email: z.email("emailInvalid"),
  password: z.string("passwordRequired").min(1, "passwordRequired"),
});

export const registration = z.object({
  email: z.email("emailInvalid"),
  password: z.string("passwordTooShort").min(8, "passwordTooShort"),
});

// Refresh credentials come from the JSON body, never ambient browser cookies.
export const refreshBody = z.object({
  refresh_token: z.string("refreshRequired").min(1, "refreshRequired"),
});

export const newPassword = z.object({
  password: z.string("passwordTooShort").min(8, "passwordTooShort"),
});

export const sidParam = z.object({
  sid: z.uuid("noSuchSession"),
});

export const tokenPair = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.string(),
});

// Scopes are grant patterns, as module.acl.ts writes them: `hello:web:*`,
// `users:bo:list`, `*`. A scope the user's role lacks grants nothing.
export const tokenRequest = z.object({
  name: z.string("tokenNameRequired").trim().min(1, "tokenNameRequired").max(100, "tokenNameTooLong"),
  scopes: z.array(z.string("scopeInvalid").refine(isGrant, "scopeInvalid")).max(32, "tooManyScopes").optional(),
  expires_in_days: z.int("expiryInvalid").min(1, "expiryInvalid").max(365, "expiryInvalid").optional(),
});

export const tokenIdParam = z.object({
  token_id: z.string().regex(/^[a-f0-9]{16}$/, "noSuchToken"),
});

export const issuedToken = z.object({
  token_id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()).nullable(),
  expires_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  secret: z.string(),
});
