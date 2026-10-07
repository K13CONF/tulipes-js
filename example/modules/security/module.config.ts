import { defineConfig } from "@tulipes/core/config";
import { z } from "zod/v4";

export default defineConfig({
  schema: z.object({
    passwordRounds: z.number().int().min(4).max(31).default(12)
      .describe("bcrypt cost factor for new password hashes; existing hashes are upgraded on login"),
  }),
});
