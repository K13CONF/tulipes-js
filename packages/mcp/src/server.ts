import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AgentTool } from "@tulipes/core/agent";

import { AgentBridge, describe } from "./bridge.js";

export interface ServerOptions {
  /** Shown to the client; the app's name is used when omitted. */
  name?: string;
  version?: string;
}

/**
 * One MCP server over one app: `tools/list` is the manifest the token's
 * role may call, `tools/call` runs the tool through the app's HTTP door
 * and returns the envelope's data — or its errors, as a tool error, so
 * the agent reads a 403 as "may not" rather than as a crash.
 */
export async function createServer(bridge: AgentBridge, options: ServerOptions = {}): Promise<Server> {
  const initial = await bridge.manifest();
  const server = new Server(
    { name: options.name ?? initial.app.name, version: options.version ?? initial.app.version ?? "0.0.0" },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: [
        `Tools of the ${initial.app.name} API. Each tool is an endpoint or a declared action of the app;`,
        "a tool marked read-only changes nothing. Inputs follow the schema; a route tool takes",
        "{ params, query, body } segments as its RAI declares them.",
        ...initial.modules.filter((module) => module.summary).map((module) => `${module.name}: ${module.summary}`),
      ].join("\n"),
    },
  );
  let tools = new Map(initial.tools.map((tool) => [tool.name, tool]));

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Re-read on every list: a role change or a redeploy shows up without a restart.
    const manifest = await bridge.manifest();
    tools = new Map(manifest.tools.map((tool) => [tool.name, tool]));
    return { tools: manifest.tools.map(toMcpTool) };
  });

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const tool = tools.get(params.name);
    if (!tool) {
      return { isError: true, content: [{ type: "text", text: `no tool named "${params.name}" — list tools again` }] };
    }
    try {
      const { status, envelope } = await bridge.call(tool, params.arguments);
      if (!envelope.success) {
        return { isError: true, content: [{ type: "text", text: `${status}: ${describe(envelope)}` }] };
      }
      const data = envelope.data;
      return {
        content: [{ type: "text", text: JSON.stringify({ data, meta: envelope.meta }) }],
        ...(typeof data === "object" && data !== null && !Array.isArray(data) && { structuredContent: data as Record<string, unknown> }),
      };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: (error as Error).message }] };
    }
  });

  return server;
}

function toMcpTool(tool: AgentTool): { name: string; title?: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> } {
  return {
    name: tool.name,
    ...(tool.title && { title: tool.title }),
    description: tool.description,
    inputSchema: { type: "object", ...tool.input_schema },
    annotations: { readOnlyHint: tool.read_only, ...(tool.title && { title: tool.title }) },
  };
}
