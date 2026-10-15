import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, onTestFinished, test, vi } from "vitest";
import { fixture } from "../../core/tests/fixture.ts";
import { serveMcp } from "../src/serve.ts";

/**
 * `serveMcp` (0.13-S03): the app booted in script mode and served in
 * process — the manifest for the configured actor, `invoke()` for a call,
 * the ACL and the credential's scopes deciding as they do over HTTP.
 */

const app = {
  "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest').defineRole('admin')
    .allow('guest', 'probe:web:count').allow('admin', 'probe:*');`,
  "modules/probe/agent/probe.agent.js": `
    import { action, defineAgent } from '@tulipes/core/agent';
    export default defineAgent({ summary: 'Counts things.', actions: [
      action({ id: 'probe:web:count', description: 'Count', readOnly: true, handler: () => 3 }),
      action({ id: 'probe:bo:purge', description: 'Purge', handler: (ctx, input, actor) => ({ purgedBy: actor.role }) }),
    ] });`,
};

async function serve(files: Record<string, string>, argv: string[] = []) {
  const { rootDir } = await fixture({ ...app, ...files });
  const audit: string[] = [];
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const served = await serveMcp({ rootDir, argv, transport: serverSide, audit: (line) => audit.push(line) });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  onTestFinished(async () => { await client.close(); await served.close(); });
  const names = async () => (await client.listTools()).tools.map((tool) => tool.name);
  const text = (result: Awaited<ReturnType<Client["callTool"]>>) => (result.content as { text: string }[])[0]!.text;
  return { client, names, text, audit };
}

test("without a config every caller is a guest, and sees what the ACL grants a guest", async () => {
  const { client, names, text } = await serve({});
  expect(await names()).toEqual(["probe_web_count"]);
  expect(text(await client.callTool({ name: "probe_web_count", arguments: {} }))).toBe('{"data":3}');
});

test("identify resolves the --token credential, its scopes narrow the list, and every call is audited", async () => {
  const { client, names, text, audit } = await serve({
    "config/mcp.config.js": `import { defineMcp } from '@tulipes/mcp';
      const tokens = { full: [], narrow: ['probe:web:*'] };
      export default defineMcp({ identify: (ctx, credential) => credential in tokens
        ? { isAuthenticated: true, user: { _id: 'u1' }, session: null, role: 'admin', ...(credential === 'narrow' && { scopes: tokens.narrow }) }
        : null });`,
  }, ["--token", "narrow"]);

  expect(await names()).toEqual(["probe_web_count"]);
  expect(text(await client.callTool({ name: "probe_web_count", arguments: {} }))).toBe('{"data":3}');
  expect(audit.map((line) => JSON.parse(line))).toEqual([expect.objectContaining({ mcp: "call", tool: "probe_web_count", actor: "u1", role: "admin", outcome: "ok" })]);
});

test("a call outside the credential's scopes is a readable tool error", async () => {
  let scopes: string[] | undefined;
  vi.stubGlobal("__probeScopes", () => scopes);
  const { client, names, text, audit } = await serve({
    "config/mcp.config.js": `import { defineMcp } from '@tulipes/mcp';
      export default defineMcp({ identify: () => ({ isAuthenticated: true, user: null, session: null, role: 'admin',
        ...(globalThis.__probeScopes() && { scopes: globalThis.__probeScopes() }) }) });`,
  });

  expect(await names()).toEqual(["probe_web_count", "probe_bo_purge"]);
  // The credential is narrowed while the session runs: identify is asked again on every call.
  scopes = ["probe:web:*"];
  const refused = await client.callTool({ name: "probe_bo_purge", arguments: {} });
  expect(refused.isError).toBe(true);
  expect(text(refused)).toMatch(/^403: .*\(OUT_OF_SCOPE\)$/);
  expect(JSON.parse(audit.at(-1)!)).toMatchObject({ tool: "probe_bo_purge", actor: "configured", outcome: "refused OUT_OF_SCOPE" });
  expect(await names()).toEqual(["probe_web_count"]);
});

test("developmentIdentity takes the role from MCP_ROLE, and is refused in production", async () => {
  const config = { "config/mcp.config.js": `import { defineMcp, developmentIdentity } from '@tulipes/mcp';
    export default defineMcp({ identify: developmentIdentity() });` };
  vi.stubEnv("MCP_ROLE", "admin");
  vi.stubEnv("APP_ENV", "development");
  const { client, names, text } = await serve(config);
  expect(await names()).toEqual(["probe_web_count", "probe_bo_purge"]);
  expect(text(await client.callTool({ name: "probe_bo_purge", arguments: {} }))).toBe('{"data":{"purgedBy":"admin"}}');

  vi.stubEnv("APP_ENV", "production");
  await expect(serve(config)).rejects.toThrow(/developmentIdentity\(\) reads the role from MCP_ROLE, which is refused when APP_ENV is production/);
});

describe("the http transport", () => {
  const httpConfig = (identify: string) => ({ "config/mcp.config.js": `import { defineMcp } from '@tulipes/mcp';
    export default defineMcp({ transport: { http: { port: 0 } }${identify} });` });
  const identifyByBearer = `, identify: (ctx, credential) => credential === 'full'
    ? { isAuthenticated: true, user: { _id: 'u1' }, session: null, role: 'admin' }
    : credential === 'narrow' ? { isAuthenticated: true, user: { _id: 'u2' }, session: null, role: 'admin', scopes: ['probe:web:*'] } : null`;

  async function listen(files: Record<string, string>) {
    const { rootDir } = await fixture({ ...app, ...files });
    const audit: string[] = [];
    const served = await serveMcp({ rootDir, argv: [], audit: (line) => audit.push(line) });
    onTestFinished(() => served.close());
    const connect = async (token?: string) => {
      const client = new Client({ name: "test", version: "0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(served.url!), {
        requestInit: { headers: token ? { authorization: `Bearer ${token}` } : {} },
      }));
      onTestFinished(() => client.close());
      return client;
    };
    return { served, connect, audit };
  }

  test("identifies every request by its bearer: each client sees what its own credential reaches", async () => {
    const { served, connect, audit } = await listen(httpConfig(identifyByBearer));
    expect(served.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const names = async (token?: string) => (await (await connect(token)).listTools()).tools.map((tool) => tool.name);
    expect(await names("full")).toEqual(["probe_web_count", "probe_bo_purge"]);
    expect(await names("narrow")).toEqual(["probe_web_count"]);
    expect(await names()).toEqual(["probe_web_count"]);

    const result = await (await connect("full")).callTool({ name: "probe_bo_purge", arguments: {} });
    expect((result.content as { text: string }[])[0]!.text).toBe('{"data":{"purgedBy":"admin"}}');
    expect(JSON.parse(audit.at(-1)!)).toMatchObject({ tool: "probe_bo_purge", actor: "u1", outcome: "ok" });
  });

  test("answers only POST on its path", async () => {
    const { served } = await listen(httpConfig(identifyByBearer));
    expect((await fetch(served.url!)).status).toBe(405);
    expect((await fetch(new URL("/elsewhere", served.url), { method: "POST", body: "{}" })).status).toBe(404);
  });

  test("refuses to serve every caller on the network as a guest in production", async () => {
    vi.stubEnv("APP_ENV", "production");
    await expect(listen(httpConfig(""))).rejects.toThrow(/http transport has no identify.*refused when APP_ENV is production/);
  });

  test("rejects a transport it does not know", async () => {
    await expect(listen({ "config/mcp.config.js": `export default { transport: { sse: true } };` })).rejects.toThrow(/not supported — "stdio" or \{ http: \{ port \} \}/);
  });
});
