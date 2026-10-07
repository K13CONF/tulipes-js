import { z } from "zod/v4";

/** Validated by rai(), and described in the generated spec. */
export const logQuery = z.object({
  process: z.enum(["backend", "worker"]).optional(),
  level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional(),
  tail: z.coerce.number().int().min(0).max(1000).optional(),
});
