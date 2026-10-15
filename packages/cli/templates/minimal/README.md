# tulipes-example

Minimal Tulipes API. Requires Node 24.x and pnpm; no MongoDB, Redis or credentials.

```sh
pnpm install
pnpm sync
pnpm typecheck
pnpm check
pnpm test
pnpm spec
pnpm dev
```

Open http://localhost:3000/api/v1/hello or http://localhost:3000/health.

`pnpm mcp` serves the modules' actions (`modules/*/agent/*.agent.ts`) to an MCP client on stdio,
as guest or as the role in `MCP_ROLE` (development only): `claude mcp add tulipes-example -- pnpm --silent mcp`.

Routes declare a RAI and use res.respond. Middleware belongs to sys modules.
Core still installs optional infrastructure libraries, but this app opens no infrastructure connections.
The production preset adds auth, users, settings, queues and deployment examples:

`tulipes init another-api --preset production`
