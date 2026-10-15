import { defineMcp } from "@tulipes/mcp";

import { identifyCredential } from "../modules/auth/lib/index.ts";

/**
 * Who an MCP client is: the credential it was started with (TULIPES_MCP_TOKEN,
 * or `--token`) — an API token from `POST /auth/tokens`, ideally
 * scoped to what the agent needs — resolved by the auth module exactly as
 * a request's bearer is: the role from the user, the scopes from the token,
 * refused once revoked. No credential, or one that is not valid, is a
 * guest. Read by `pnpm mcp` only.
 */
export default defineMcp({
  // stdio: one client that starts this process (`TULIPES_MCP_TOKEN=… pnpm mcp`).
  // For remote agents, `{ http: { port: 3100 } }` serves MCP's Streamable
  // HTTP on 127.0.0.1:3100/mcp, each request identified by its
  // `Authorization: Bearer` (see the commented block in nginx/production.conf).
  transport: "stdio",
  identify: (ctx, credential) => identifyCredential(ctx, credential),
});
