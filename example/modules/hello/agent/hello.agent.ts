import { action, defineAgent } from "@tulipes/core/agent";
import { requireModels } from "@tulipes/core/boot";
import { z } from "zod/v4";

import { findGreetings } from "../helpers/greetings.ts";

/**
 * What this module offers to agents — an in-app agent module reads it from
 * `ctx.agent.manifest()`, Claude Code through `tulipes-mcp`. Routes are the
 * API and are never tools: an action is declared here, with its own id (a
 * permission granted in module.acl.ts), input schema and handler, and
 * shares its logic with the routes through helpers/. `pnpm tulipes agent
 * manifest` prints the result.
 */
export default defineAgent({
  summary: "Greets callers and counts how often each greeting is used.",
  actions: [
    action({
      id: "hello:web:greetings",
      description: "The stored greetings, with how often each was used",
      readOnly: true,
      handler: async (ctx) => (await findGreetings(ctx))[0],
    }),

    // The ACL decides on the id (admin holds hello:* in the auth module's
    // ACL), then the schema validates, then this runs.
    action({
      id: "hello:bo:greetings:reset",
      description: "Reset the usage counter of every greeting to zero",
      input: z.object({ confirm: z.literal(true).describe("Set to true to confirm the reset") }),
      handler: async (ctx) => {
        const { modifiedCount } = await requireModels(ctx).get("Greeting").updateMany({}, { times_used: 0 });
        return { reset: modifiedCount };
      },
    }),
  ],
});
