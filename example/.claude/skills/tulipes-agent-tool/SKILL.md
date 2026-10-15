---
name: tulipes-agent-tool
description: Use when a Tulipes module should offer something to AI agents — declaring an action, describing the module, building an agent inside the app from the other modules' actions, or wiring the app to Claude Code through MCP. Covers agent/*.agent.ts, ctx.agent, the manifest, the agent door, `pnpm mcp` and config/mcp.config.ts.
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
      id: "hello:web:greetings",
      description: "The stored greetings, with how often each was used",
      readOnly: true,
      handler: async (ctx) => (await findGreetings(ctx))[0],
    }),
    action({
      id: "hello:bo:greetings:reset",
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

- **An action's id is a RAI like any route's**, `module:scope:resource[:extra]`:
  the scope says who it is for (`hello:bo:greetings:reset` is a back-office
  action). The ACL decides on
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
  (`hello:bo:greetings:reset` → `hello_bo_greetings_reset`); a name two modules claim
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

## MCP: `pnpm mcp`

The app is its own MCP server. `mcp.ts` (beside `app.ts`) boots the app in
script mode and serves the actions in process: `tools/list` is
`ctx.agent.manifest(actor)`, `tools/call` is `ctx.agent.invoke()`, so the
ACL, the credential's scopes and the input schemas decide exactly as they
do over HTTP. Who the caller is comes from `config/mcp.config.ts`:

```ts
export default defineMcp({
  transport: "stdio",
  // The production preset resolves the bearer through the auth module;
  // the minimal preset uses developmentIdentity("MCP_ROLE"), refused in production.
  identify: (ctx, credential) => identifyCredential(ctx, credential),
});
```

```sh
claude mcp add my-app -- pnpm --silent mcp --token "$TOKEN"   # or TULIPES_MCP_TOKEN
```

For remote agents, `transport: { http: { port: 3100 } }` serves MCP's
Streamable HTTP at `http://127.0.0.1:3100/mcp` instead; every request is
identified by its own `Authorization: Bearer`, and in production the
process refuses to listen without an `identify`.

No `identify`, or a credential it does not accept, is a guest. `identify`
runs again on every list and call, so a revoked token or a changed role
applies to a running session. Every call writes one audit line to stderr;
stdout is the protocol, and the app's own logs are moved off it.

## The door

For agents that reach the app over HTTP, the `agent` module serves the
manifest at `GET <prefix>/agent/tools`, filtered to the caller's role and
scopes, and runs actions at `POST <prefix>/agent/tools/<name>`. The
`tulipes-mcp` bin bridges that door to stdio
(`pnpm tulipes-mcp --url http://localhost:3000/api/v1/agent --token "$TOKEN"`)
for a client that cannot start a process beside the app; it adds no
identity of its own and never touches the database.
