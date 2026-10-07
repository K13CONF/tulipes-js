import { defineConfig } from "@tulipes/core/config";
import { z } from "zod/v4";

export default defineConfig({
  schema: z.object({
    maxSessions: z.number().int().positive().default(5)
      .describe("Max concurrent sessions per user; the oldest is evicted past it"),
    signupMode: z.enum(["open", "invite", "closed"]).default("open")
      .describe("Who can register: open to anyone, invite only, or nobody"),
  }),
});
