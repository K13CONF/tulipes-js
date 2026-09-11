import { z } from "zod/v4";

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
