import { defineMcp } from "@tulipes/mcp";

import { identifyCredential } from "../modules/auth/lib/index.ts";

/**
 * Who an MCP client is: the credential it was started with (`--token` or
 * TULIPES_MCP_TOKEN) — an API token from `POST /auth/tokens`, ideally
 * scoped to what the agent needs — resolved by the auth module exactly as
 * a request's bearer is: the role from the user, the scopes from the token,
 * refused once revoked. No credential, or one that is not valid, is a
 * guest. Read by `pnpm mcp` only.
 */
export default defineMcp({
  transport: "stdio",
  identify: (ctx, credential) => identifyCredential(ctx, credential),
});
