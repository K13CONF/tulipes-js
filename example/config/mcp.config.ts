import { defineMcp } from "@tulipes/mcp";

import { identifyCredential } from "../modules/auth/lib/index.ts";

/**
 * Who an MCP client is: the credential it was started with (`--token` or
 * TULIPES_MCP_TOKEN), resolved by the auth module exactly as a request's
 * bearer is — the role from the user, refused once revoked. No credential,
 * or one that is not valid, is a guest. Read by `pnpm mcp` only.
 */
export default defineMcp({
  transport: "stdio",
  identify: (ctx, credential) => identifyCredential(ctx, credential),
});
