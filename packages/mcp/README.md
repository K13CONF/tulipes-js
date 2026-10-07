<div align="center">

<img src="https://cdn.jsdelivr.net/npm/@tulipes/core@0.7.1/assets/tulipesjs-logo.png" alt="TulipesJs" width="340">

</div>

# @tulipes/mcp

An [MCP](https://modelcontextprotocol.io) server over a [Tulipes](https://www.npmjs.com/package/@tulipes/core)
app's agent tools. Every endpoint an app declares with `rai()` is a tool
already — name, description, input schema and permission — and a module's
`agent/*.agent.ts` adds a summary, curates which routes an agent sees and
declares actions that are not endpoints. The app serves that manifest at
its agent door; this package puts it on stdio for Claude Code, Claude
Desktop or any MCP client.

Requires Node 24.x and an app on `@tulipes/core` 0.11 or later with its
`agent` module mounted (`tulipes init` scaffolds one).

> [!WARNING]
> **Experimental.** This package and the core agent surface it serves are
> outside the 0.11 compatibility promise. Flags, tool naming and the manifest
> may change in any release without a deprecation period.

## Run it

```sh
pnpm add -D @tulipes/mcp
pnpm tulipes-mcp --url http://localhost:3000/api/v1/agent --token <bearer token>
```

`--url` is the agent door (`<prefix>/agent`, default
`http://localhost:3000/api/v1/agent`, or `TULIPES_URL`); `--token` is a bearer
token the app's auth module accepts (or `TULIPES_TOKEN`). Without a token the
server calls as guest and lists only what a guest may call.

For Claude Code:

```sh
claude mcp add tulipes-example -- pnpm tulipes-mcp --token "$TOKEN"
```

## What it does

- `tools/list` reads the manifest from `GET <url>/tools`, filtered by the
  token's role, and lists each tool with its JSON Schema input and a
  `readOnlyHint` for `GET` routes and actions that say so.
- `tools/call` runs the tool **through the app**: a route tool at its own
  method and path on the app's origin, with `params` in the path, `query` as
  the query string and `body` as JSON; an action through
  `POST <url>/tools/<name>`. The same bearer token goes on every request, so
  the app's auth decides who is calling and its ACL what they may do. This
  package adds no identity of its own and never touches the database.
- A refusal (401, 403, 422) comes back as a tool error carrying the
  envelope's errors, so an agent reads "may not" rather than a crash.

## In code

```ts
import { AgentBridge, createServer } from "@tulipes/mcp";

const bridge = new AgentBridge({ url: "http://localhost:3000/api/v1/agent", token });
const server = await createServer(bridge);
await server.connect(transport); // any @modelcontextprotocol/sdk transport
```

## Generate the manifest without a server

`tulipes agent manifest` writes the same document from an inspection boot —
no service, secret or `.env` — for a tool-definition file or a review of
what an app exposes.
