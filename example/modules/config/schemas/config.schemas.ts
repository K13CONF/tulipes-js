import { z } from "zod/v4";

/** Validated by rai(), and described in the generated spec and the agent manifest. */
export const moduleParam = z.object({
  module: z.string().regex(/^[a-z][a-z0-9-]*$/, "invalidModuleName"),
});

export const changeBody = z.object({
  /** A patch over the stored values; the module's own schema validates the result. */
  values: z.record(z.string(), z.unknown()),
  /** The version read before editing; a different stored version refuses the write. Required, so a stale editor always fails. */
  version: z.number().int().positive(),
});
