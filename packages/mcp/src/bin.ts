#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AgentBridge } from "./bridge.js";
import { createServer } from "./server.js";

const HELP = `tulipes-mcp — serve a Tulipes app's agent tools over MCP (stdio)

Usage:
  tulipes-mcp [--url <agent door>] [--token <bearer token>]

  --url    the app's agent door; default TULIPES_URL or http://localhost:3000/api/v1/agent
  --token  a bearer token the app's auth accepts; default TULIPES_TOKEN; none calls as guest

The server lists the tools that identity may call and runs each through the
app's own HTTP endpoints — the app's auth and ACL decide, as for any client.
`;

export async function main(argv: readonly string[]): Promise<void> {
  let url = process.env.TULIPES_URL ?? "http://localhost:3000/api/v1/agent";
  let token = process.env.TULIPES_TOKEN;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--help" || flag === "-h") {
      process.stdout.write(HELP);
      return;
    }
    if ((flag === "--url" || flag === "--token") && value !== undefined) {
      if (flag === "--url") url = value; else token = value;
      i++;
      continue;
    }
    process.stderr.write(`unknown or incomplete option "${flag}"\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }

  const bridge = new AgentBridge({ url, token });
  const server = await createServer(bridge);
  await server.connect(new StdioServerTransport());
}

main(process.argv.slice(2)).catch((error: Error) => {
  process.stderr.write(`tulipes-mcp: ${error.message}\n`);
  process.exitCode = 1;
});
