import { serveMcp } from "@tulipes/mcp";

// The app as an MCP server: boots in script mode and serves the actions
// modules declare in agent/*.agent.ts to the caller config/mcp.config.ts
// identifies. For Claude Code:
//
//   claude mcp add tulipes-example -- pnpm --silent mcp --token "$TOKEN"
await serveMcp({ rootDir: import.meta.dirname });
