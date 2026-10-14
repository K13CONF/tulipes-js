import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AgentManifest, AgentTool } from "@tulipes/core/agent";

import { AgentBridge, describe } from "./bridge.ts";

/** What a server serves: a manifest, and a way to run one of its tools. */
export interface ToolSource {
  manifest(): Promise<AgentManifest>;
  call(tool: AgentTool, input: unknown): Promise<ToolOutcome>;
}

/** A tool's result, or the readable reason it was refused or failed. */
export type ToolOutcome = { ok: true; data: unknown; meta?: Record<string, unknown> } | { ok: false; message: string };

/** The app's HTTP door as a tool source: the bridge `tulipes-mcp` runs. */
export function bridgeSource(bridge: AgentBridge): ToolSource {
  return {
    manifest: () => bridge.manifest(),
    call: async (tool, input) => {
      const { status, envelope } = await bridge.call(tool, input);
      return envelope.success
        ? { ok: true, data: envelope.data, meta: envelope.meta }
        : { ok: false, message: `${status}: ${describe(envelope)}` };
    },
  };
}

export interface ServerOptions {
  /** Shown to the client; the app's name is used when omitted. */
  name?: string;
  version?: string;
}

/**
 * One MCP server over one app: `tools/list` is the manifest the caller may
 * call, `tools/call` runs the action — through the app's HTTP door for a
 * bridge, in process for `serveMcp` — and returns its data, or the refusal
 * as a tool error, so the agent reads a 403 as "may not" rather than as a
 * crash.
 */
export async function createServer(source: AgentBridge | ToolSource, options: ServerOptions = {}): Promise<Server> {
  const served = source instanceof AgentBridge ? bridgeSource(source) : source;
  const initial = await served.manifest();
  const server = new Server(
    { name: options.name ?? initial.app.name, version: options.version ?? initial.app.version ?? "0.0.0" },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: [
        `Tools of the ${initial.app.name} app: the actions its modules declare. A tool marked`,
        "read-only changes nothing. Inputs follow the schema.",
        ...initial.modules.filter((module) => module.summary).map((module) => `${module.name}: ${module.summary}`),
      ].join("\n"),
    },
  );
  let tools = new Map(initial.tools.map((tool) => [tool.name, tool]));

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Re-read on every list: a role change or a redeploy shows up without a restart.
    const manifest = await served.manifest();
    tools = new Map(manifest.tools.map((tool) => [tool.name, tool]));
    return { tools: manifest.tools.map(toMcpTool) };
  });

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const tool = tools.get(params.name);
    if (!tool) {
      return { isError: true, content: [{ type: "text", text: `no tool named "${params.name}" — list tools again` }] };
    }
    try {
      const outcome = await served.call(tool, params.arguments);
      if (!outcome.ok) return { isError: true, content: [{ type: "text", text: outcome.message }] };
      const { data, meta } = outcome;
      return {
        content: [{ type: "text", text: JSON.stringify(meta ? { data, meta } : { data }) }],
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
