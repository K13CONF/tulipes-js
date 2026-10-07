import { action, defineAgent } from "@tulipes/core/agent";
import { requireModels } from "@tulipes/core/boot";
import { z } from "zod/v4";

/**
 * What an agent sees of this module. Every route is a tool already — its
 * rai() gives the name, description, input schema and permission — so this
 * file adds what cannot be derived: the summary, which routes to expose,
 * and an action that is not an endpoint. A module without this file
 * exposes every route; `pnpm tulipes agent manifest` prints the result.
 */
export default defineAgent({
  summary: "Greets callers and counts how often each greeting is used.",
  tools: [
    { route: "hello:greet", description: "A greeting in the caller's language" },
    { route: "hello:greet-name" },
    { route: "hello:list-greetings", description: "The stored greetings, with how often each was used" },
    { route: "hello:use-greeting" },

    // An action: the id is a permission like any route's, granted to
    // admin through hello:* in the auth module's ACL. The ACL decides,
    // then the schema validates, then this runs.
    action({
      id: "hello:reset-counts",
      description: "Reset the usage counter of every greeting to zero",
      input: z.object({ confirm: z.literal(true).describe("Set to true to confirm the reset") }),
      handler: async (ctx) => {
        const { modifiedCount } = await requireModels(ctx).get("Greeting").updateMany({}, { times_used: 0 });
        return { reset: modifiedCount };
      },
    }),
  ],
});
