import { defineConfig } from "@tulipes/core/config";
import { z } from "zod/v4";

/**
 * Whatever this declares is stored at `config.hello`, edited through the
 * console, typed by `pnpm sync`, and read live by every other module — a
 * change lands without a restart.
 */
export default defineConfig({
  schema: z.object({
    greeting: z.string().min(1).default("Hello")
      .describe("Word this module greets callers with"),
  }),
});
