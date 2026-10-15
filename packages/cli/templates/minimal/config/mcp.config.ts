import { defineMcp, developmentIdentity } from "@tulipes/mcp";

/**
 * Who an MCP client is. This app has no auth module, so the role comes
 * from MCP_ROLE (unset is guest) — a development convenience `pnpm mcp`
 * refuses when APP_ENV is production or staging. An app with an auth
 * module identifies the credential instead: see the production preset.
 */
export default defineMcp({
  transport: "stdio",
  identify: developmentIdentity("MCP_ROLE"),
});
