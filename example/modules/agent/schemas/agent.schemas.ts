import { z } from "zod/v4";

/** The tool name as the manifest lists it. */
export const toolName = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, "invalidToolName"),
});

/** The tool's input — the action's own schema validates it next. */
export const toolInput = z.looseObject({});
