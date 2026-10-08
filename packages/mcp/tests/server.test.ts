import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, test } from "vitest";
import { AgentBridge } from "../src/bridge.ts";
import { createServer } from "../src/server.ts";

/**
 * A stand-in for the app's agent door, in the envelope every Tulipes
 * endpoint answers with: the manifest and two actions. What arrives —
 * method, path, body, bearer token — is recorded, because that is the
 * whole contract of the bridge.
 */
const manifest = {
  app: { name: "probe", version: "1.2.3" },
  authorization: "acl",
  modules: [{ name: "things", summary: "Keeps things.", tools: ["things_count", "things_reset"] }],
  tools: [
    { name: "things_count", module: "things", permission: "things:count", title: "Count things", description: "How many", read_only: true,
      input_schema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "things_reset", module: "things", permission: "things:reset", description: "Reset", read_only: false,
      input_schema: { type: "object", properties: { confirm: { type: "boolean" } }, required: ["confirm"], additionalProperties: false } },
  ],
};

const seen: { method?: string; url?: string; auth?: string; body?: unknown }[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); seen.splice(0); });

async function door(): Promise<string> {
  const respond = (res: ServerResponse, status: number, data: unknown, errors: unknown[] = []) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: errors.length === 0, data, errors, meta: {} }));
  };
  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : undefined;
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
    const url = new URL(req.url!, "http://x");
    if (req.method === "GET" && url.pathname === "/api/v1/agent/tools") {
      return respond(res, 200, req.headers.authorization === "Bearer secret" ? manifest : { ...manifest, tools: manifest.tools.slice(0, 1) });
    }
    if (req.method === "POST" && url.pathname === "/api/v1/agent/tools/things_count") return respond(res, 200, 3);
    if (req.method === "POST" && url.pathname === "/api/v1/agent/tools/things_reset") {
      if (req.headers.authorization !== "Bearer secret") return respond(res, 403, null, [{ field: null, message: 'role "guest" may not things:reset', code: "FORBIDDEN" }]);
      if (body?.confirm !== true) return respond(res, 422, null, [{ field: "confirm", message: "Invalid input", code: "INVALID_LITERAL" }]);
      return respond(res, 200, { reset: 3 });
    }
    res.writeHead(404, { "content-type": "text/plain" }).end("nope");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise((resolve) => server.close(() => resolve())));
  const { port } = server.address() as { port: number };
  return `http://127.0.0.1:${port}/api/v1/agent`;
}

async function connect(token?: string) {
  const bridge = new AgentBridge({ url: await door(), token });
  const server = await createServer(bridge);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  closers.push(async () => { await client.close(); await server.close(); });
  return client;
}

test("lists the manifest as MCP tools, with the token's role deciding what is listed", async () => {
  const admin = await connect("secret");
  const { tools } = await admin.listTools();
  expect(tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint])).toEqual([["things_count", true], ["things_reset", false]]);
  expect(tools[0]).toMatchObject({ title: "Count things", description: "How many", inputSchema: { type: "object", properties: {}, additionalProperties: false } });
  expect(seen.at(-1)).toMatchObject({ method: "GET", url: "/api/v1/agent/tools", auth: "Bearer secret" });

  const guest = await connect();
  expect((await guest.listTools()).tools.map((tool) => tool.name)).toEqual(["things_count"]);
  expect(seen.at(-1)?.auth).toBeUndefined();
});

test("every tool is called through the door with the same bearer token", async () => {
  const client = await connect("secret");

  const count = await client.callTool({ name: "things_count", arguments: {} });
  expect(count).toMatchObject({ content: [{ type: "text", text: JSON.stringify({ data: 3, meta: {} }) }] });
  expect(seen.at(-1)).toMatchObject({ method: "POST", url: "/api/v1/agent/tools/things_count", auth: "Bearer secret", body: {} });

  const reset = await client.callTool({ name: "things_reset", arguments: { confirm: true } });
  expect(reset).toMatchObject({ structuredContent: { reset: 3 }, content: [{ type: "text", text: JSON.stringify({ data: { reset: 3 }, meta: {} }) }] });
  expect(seen.at(-1)).toMatchObject({ method: "POST", url: "/api/v1/agent/tools/things_reset", body: { confirm: true } });
});

test("the app's refusals come back as tool errors the agent can read, never as crashes", async () => {
  const client = await connect("secret");
  expect(await client.callTool({ name: "things_reset", arguments: { confirm: false } })).toMatchObject({ isError: true, content: [{ type: "text", text: "422: confirm: Invalid input (INVALID_LITERAL)" }] });
  expect(await client.callTool({ name: "unknown_tool", arguments: {} })).toMatchObject({ isError: true });

  const guest = await connect();
  await guest.listTools();
  // Listed for the token's role only, so a guest never sees the action; the door still answers a direct call with its reason.
  const bridge = new AgentBridge({ url: await door() });
  const { status, envelope } = await bridge.call(manifest.tools[1] as never, { confirm: true });
  expect({ status, code: envelope.errors[0]?.code }).toEqual({ status: 403, code: "FORBIDDEN" });
});
