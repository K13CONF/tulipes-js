---
name: tulipes-agent-tool
description: Use when exposing a Tulipes module to AI agents — describing it, choosing which endpoints an agent sees, adding an action that is not an endpoint, or wiring the app to Claude Code through MCP. Covers agent/*.agent.ts, the manifest, the agent door and tulipes-mcp.
---

# Exposing a module to agents

Every endpoint is already a tool: its `rai()` declares the name, the
description, the input schema (`params`, `query`, `body`) and the
permission, and the boot derives a tool from it — `hello:list-greetings`
becomes `hello_list-greetings`, a `GET` is marked read-only. A module with
no `agent/` folder exposes every route it declares. The folder adds what
cannot be derived.

`modules/hello/agent/hello.agent.ts`:

```ts
import { action, defineAgent } from "@tulipes/core/agent";
import { requireModels } from "@tulipes/core/boot";
import { z } from "zod/v4";

export default defineAgent({
  summary: "Greets callers and counts how often each greeting is used.",
  tools: [
    // Derived from the route; the description overrides the RAI's for agents only.
    { route: "hello:list-greetings", description: "The stored greetings, most used first" },
    { route: "hello:use-greeting" },

    // Declared: not an endpoint. The id is a permission, granted in module.acl.ts.
    action({
      id: "hello:reset-counts",
      description: "Reset the usage counter of every greeting to zero",
      input: z.object({ confirm: z.literal(true) }),
      handler: async (ctx, input, actor) => {
        const { modifiedCount } = await requireModels(ctx).get("Greeting").updateMany({}, { times_used: 0 });
        return { reset: modifiedCount };
      },
    }),
  ],
});
```

`pnpm tulipes agent manifest` prints the result from an inspection boot —
no service or `.env` needed; `--role admin` shows what one role gets.

## Rules

- **`tools` omitted exposes every route; given, it is the whole list.**
  `{ route: "*" }` is every route of the module, `{ route: "hello:*" }` a
  namespace, an exact id one route. A route id the module never declared is
  a boot error. One `agent/*.agent.ts` per module.
- **An endpoint that must stay out of the manifest says `agent: false`** on
  its `rai()` — the agent door's own routes do.
- **An action's id is a permission like any route's.** The ACL decides on
  it first (401 for a guest, 403 for a role without it), then the `input`
  schema validates (422 with field issues), then the handler runs with the
  runtime context, the parsed input and the actor (`req.auth` plus `role`).
  Grant it in `module.acl.ts`; a wildcard such as `hello:*` already covers it.
- **Write the description for the agent, not the operator.** It is the only
  text the model sees before choosing the tool. Say what the tool does, what
  it changes and what it returns; keep `readOnly: true` honest.
- **Route tools are called at their own path**, through the app's middleware
  and auth, never around it. The manifest gives the method and path; the
  input is `{ params, query, body }` as the RAI declares them. A path
  parameter without a `params` schema is still listed as a required string.
- **Keep handlers small.** An action that grows a second step is a
  controller in disguise: move the logic to `helpers/` and call it from both.

## The door and MCP

The app's `agent` module serves the manifest at `GET <prefix>/agent/tools`,
filtered to the caller's role, and runs actions at
`POST <prefix>/agent/tools/<name>`. Any client with a bearer token the auth
module accepts can use it. For Claude Code or Claude Desktop:

```sh
pnpm add -D @tulipes/mcp
claude mcp add my-app -- pnpm tulipes-mcp --url http://localhost:3000/api/v1/agent --token "$TOKEN"
```

`tulipes-mcp` lists the manifest as MCP tools and calls each through the
door with that token, so the app's own auth and ACL decide — it adds no
identity of its own and never touches the database.
