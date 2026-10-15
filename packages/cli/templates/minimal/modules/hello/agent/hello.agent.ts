import { action, defineAgent } from "@tulipes/core/agent";
import { z } from "zod/v4";

/**
 * What this module offers to agents: `pnpm mcp` serves it, `ctx.agent`
 * lists it to other modules. Routes are the API and are never tools; an
 * action has its own id, granted in module.acl.ts like a route's.
 */
export default defineAgent({
  summary: "Says hello.",
  actions: [
    action({
      id: "hello:web:greet",
      description: "A greeting, optionally addressed to someone",
      readOnly: true,
      input: z.object({ name: z.string().optional().describe("Who to greet") }),
      handler: (ctx, { name }) => ({ message: name ? `Hello, ${name}` : "Hello" }),
    }),
  ],
});
