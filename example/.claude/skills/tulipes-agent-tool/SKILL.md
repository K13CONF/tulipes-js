---
name: tulipes-agent-tool
description: Use when a Tulipes module should offer something to AI agents — declaring an action, describing the module, building an agent inside the app from the other modules' actions, or wiring the app to Claude Code through MCP. Covers agent/*.agent.ts, ctx.agent, the manifest, the agent door and tulipes-mcp.
---

# Offering a module's actions to agents

Routes are the API. What a module offers to agents — and to an agent
module inside the same app — is a separate, explicit list: its **actions**,
declared in `agent/<module>.agent.ts`. Nothing is derived from the routes,
and a module with no `agent/` file offers nothing.

The agent surface and `@tulipes/mcp` are **experimental** in 0.11: they may
change in any release without a deprecation period. Check `MIGRATING.md`
after each `@tulipes/core` upgrade before relying on a manifest shape.

`modules/hello/agent/hello.agent.ts`:

```ts
import { action, defineAgent } from "@tulipes/core/agent";
import { requireModels } from "@tulipes/core/boot";
import { z } from "zod/v4";

import { findGreetings } from "../helpers/greetings.ts";

export default defineAgent({
  summary: "Greets callers and counts how often each greeting is used.",
  actions: [
    action({
      id: "hello:list-greetings",
      description: "The stored greetings, with how often each was used",
      readOnly: true,
      handler: async (ctx) => (await findGreetings(ctx))[0],
    }),
    action({
      id: "hello:reset-counts",
      description: "Reset the usage counter of every greeting to zero",
      input: z.object({ confirm: z.literal(true) }),
      handler: async (ctx) => {
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

- **An action's id is a permission like any route's.** The ACL decides on
  it first (401 for a guest, 403 for a role without it), then the `input`
  schema validates (422 with field issues), then the handler runs with the
  runtime context, the parsed input and the actor (`req.auth` plus `role`).
  Grant it in `module.acl.ts`; a wildcard such as `hello:*` already covers
  it. An action that does what a route does may share the route's id, so
  one grant covers both.
- **Logic lives in `helpers/`, called from both.** A route controller and
  an action call the same helper; a route never calls an action and an
  action never calls a route. An action that grows a second step is a
  controller in disguise.
- **Write the description for the agent, not the operator.** It is the only
  text the model sees before choosing the tool. Say what the tool does, what
  it changes and what it returns; keep `readOnly: true` honest.
- **One `agent/*.agent.ts` per module.** Tool names come from the id
  (`hello:reset-counts` → `hello_reset-counts`); a name two modules claim
  is a boot error.

## An agent inside the app

`ctx.agent` exists in every process — backend, worker, script — once the
ACL is loaded. An agent module runs a model against the other modules'
actions without any HTTP:

```ts
const { tools } = ctx.agent.manifest(actor.role);   // name, description, input_schema: a tool definition each
const result = await ctx.agent.invoke(name, input, actor); // ACL, then schema, then the handler
```

A long run belongs in a queue job (`queues/`), where `ctx.agent` is the
same registry.

## The door and MCP

For agents outside the process, the app's `agent` module serves the
manifest at `GET <prefix>/agent/tools`, filtered to the caller's role, and
runs actions at `POST <prefix>/agent/tools/<name>`. Any client with a
bearer token the auth module accepts can use it. For Claude Code or Claude
Desktop:

```sh
pnpm add -D @tulipes/mcp
claude mcp add my-app -- pnpm tulipes-mcp --url http://localhost:3000/api/v1/agent --token "$TOKEN"
```

`tulipes-mcp` lists the manifest as MCP tools and calls each through the
door with that token, so the app's own auth and ACL decide — it adds no
identity of its own and never touches the database.
